"use client";

import { useRef, useState } from "react";
import { Sparkles, Loader2, Upload, Check, X, AlertTriangle } from "lucide-react";
import { TIPO_DOCUMENTO_LABEL, type DatosImpositivos } from "@/lib/documento-impositivo";

const TIPOS_OK = ["application/pdf", "image/png", "image/jpeg", "image/webp"];

const CONDICION_LABEL: Record<string, string> = {
  RI: "Responsable Inscripto",
  Monotributo: "Monotributo",
  Exento: "Exento",
  CF: "Consumidor Final",
};

function fechaAR(f: string | null) {
  if (!f) return null;
  const m = f.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : f;
}

function cuitAR(c: string | null) {
  if (!c) return null;
  return c.length === 11 ? `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}` : c;
}

/** Botón que lee con IA una constancia ARCA / certificado de exención o exclusión y propone los datos. Solo aplica si el usuario aprieta "Aplicar". */
export function LeerDocumentoImpositivo({ onDatos, compacto, cuitEsperado }: { onDatos: (d: DatosImpositivos) => void; compacto?: boolean; /** CUIT del proveedor/cliente que se está cargando: si el papel es de otro, no se aplican IVA ni exclusiones. */ cuitEsperado?: string | null }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [abierto, setAbierto] = useState(false);
  const [leyendo, setLeyendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [datos, setDatos] = useState<DatosImpositivos | null>(null);
  const [arrastrando, setArrastrando] = useState(false);
  const [archivo, setArchivo] = useState<string | null>(null);

  async function leer(file: File | null | undefined) {
    if (!file) return;
    setError(null);
    setDatos(null);
    if (!TIPOS_OK.includes(file.type)) {
      setError("Ese archivo no sirve: subí un PDF o una imagen (JPG, PNG).");
      return;
    }
    setArchivo(file.name);
    setLeyendo(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/parse-documento-impositivo", { method: "POST", body: fd });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success || !json?.data) {
        setError(json?.error || "No se pudo leer el papel. Probá con otro archivo o cargá los datos a mano.");
      } else {
        setDatos(json.data as DatosImpositivos);
      }
    } catch {
      setError("No se pudo conectar para leer el papel. Probá de nuevo o cargá los datos a mano.");
    } finally {
      setLeyendo(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function cerrar() {
    setAbierto(false);
    setDatos(null);
    setError(null);
    setArchivo(null);
  }

  const cuitPapel = (datos?.cuit || "").replace(/\D/g, "");
  const cuitCarga = (cuitEsperado || "").replace(/\D/g, "");
  const cuitDistinto = !!cuitPapel && !!cuitCarga && cuitPapel !== cuitCarga;

  function aplicar() {
    if (!datos) return;
    const aEnviar: DatosImpositivos = cuitDistinto
      ? { ...datos, condicion_iva: null, exclusion_desde: null, exclusion_hasta: null, numero_certificado: null, porcentaje_exclusion: null, tipo_documento: "otro" }
      : datos;
    try {
      onDatos(aEnviar);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron aplicar los datos.");
      return;
    }
    cerrar();
  }

  const filas: Array<[string, string | null]> = datos
    ? [
        ["Documento", TIPO_DOCUMENTO_LABEL[datos.tipo_documento] || datos.tipo_documento],
        ["CUIT", cuitAR(datos.cuit)],
        ["Razón social", datos.razon_social],
        ["Condición IVA", datos.condicion_iva ? CONDICION_LABEL[datos.condicion_iva] || datos.condicion_iva : null],
        ["Domicilio", [datos.direccion, datos.localidad, datos.provincia].filter(Boolean).join(", ") || null],
        ["Exclusión desde", fechaAR(datos.exclusion_desde)],
        ["Exclusión hasta", fechaAR(datos.exclusion_hasta)],
        ["Certificado", datos.numero_certificado],
        ["% exclusión", datos.porcentaje_exclusion != null ? `${datos.porcentaje_exclusion} %` : null],
      ]
    : [];

  const input = (
    <input ref={inputRef} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="hidden"
      onChange={e => void leer(e.target.files?.[0])} />
  );

  if (!abierto) {
    return (
      <button type="button" onClick={() => { setAbierto(true); setTimeout(() => inputRef.current?.click(), 0); }}
        className={`inline-flex items-center gap-1 rounded-full border border-violet-300 text-violet-700 hover:bg-violet-50 dark:border-violet-800 dark:text-violet-300 dark:hover:bg-violet-900/20 ${compacto ? "px-2 py-0.5 text-[11px]" : "px-3 py-1 text-xs"}`}>
        <Sparkles size={compacto ? 11 : 13} /> Leer papel impositivo con IA
        {input}
      </button>
    );
  }

  return (
    <div className={`rounded-lg border border-violet-200 bg-violet-50/50 dark:border-violet-900 dark:bg-violet-950/20 ${compacto ? "p-2 text-[11px]" : "p-3 text-xs"}`}>
      {input}
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 font-medium text-violet-700 dark:text-violet-300"><Sparkles size={13} /> Leer papel impositivo con IA</span>
        <button type="button" onClick={cerrar} className="rounded p-0.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200" title="Cerrar"><X size={14} /></button>
      </div>

      {!datos && !leyendo && (
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setArrastrando(true); }}
          onDragLeave={() => setArrastrando(false)}
          onDrop={e => { e.preventDefault(); setArrastrando(false); void leer(e.dataTransfer.files?.[0]); }}
          className={`flex cursor-pointer flex-col items-center gap-1 rounded-md border-2 border-dashed px-3 py-3 text-center text-zinc-500 dark:text-zinc-400 ${arrastrando ? "border-violet-400 bg-violet-100/60 dark:bg-violet-900/30" : "border-zinc-300 hover:border-violet-300 dark:border-zinc-700"}`}>
          <Upload size={16} />
          <span>Arrastrá acá la constancia de ARCA o el certificado (PDF, JPG o PNG), o hacé clic para elegirlo.</span>
        </div>
      )}

      {leyendo && (
        <div className="flex items-center gap-2 py-2 text-violet-700 dark:text-violet-300">
          <Loader2 size={14} className="animate-spin" /> Leyendo {archivo || "el papel"}…
        </div>
      )}

      {error && (
        <div className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" /> <span>{error}</span>
        </div>
      )}

      {datos && (
        <div className="space-y-2">
          <p className="text-zinc-500 dark:text-zinc-400">Esto es lo que leyó la IA{archivo ? ` en ${archivo}` : ""}. Revisalo antes de aplicar.</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 rounded-md bg-white px-2 py-1.5 dark:bg-zinc-900">
            {filas.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-zinc-500 dark:text-zinc-400">{k}</dt>
                <dd className={v ? "font-medium text-zinc-800 dark:text-zinc-100" : "text-zinc-400"}>{v || "—"}</dd>
              </div>
            ))}
          </dl>
          {cuitDistinto && (
            <div className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>El papel es del CUIT {cuitAR(cuitPapel)}, no del que estás cargando ({cuitAR(cuitCarga)}). No se aplican condición de IVA ni exclusiones.</span>
            </div>
          )}
          {datos.porcentaje_exclusion != null && datos.porcentaje_exclusion < 100 && (
            <p className="rounded-md bg-amber-50 px-2 py-1 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">Exclusión parcial: {datos.porcentaje_exclusion} %</p>
          )}
          {datos.resumen && <p className="italic text-zinc-600 dark:text-zinc-300">{datos.resumen}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={cerrar} className="rounded-md border border-zinc-300 px-2.5 py-1 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">Descartar</button>
            <button type="button" onClick={aplicar} className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-2.5 py-1 font-medium text-white hover:bg-violet-700"><Check size={13} /> Aplicar</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default LeerDocumentoImpositivo;
