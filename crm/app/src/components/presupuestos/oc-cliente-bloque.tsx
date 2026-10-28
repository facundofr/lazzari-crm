"use client";

/**
 * "OC del cliente" en el detalle del PR: número + fecha + archivo en un solo lugar (sin prompt del navegador).
 * Al elegir el PDF, la IA sugiere el número y la fecha ✨ (solo sugiere: se revisa y se guarda con el botón).
 * Si se cambia el número, el anterior queda en las notas internas como "EX OC" (trazabilidad).
 */
import { useState } from "react";
import { FileText, Loader2, Pencil, Sparkles, Trash2, Upload } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import { formatDate, todayAR } from "@/lib/utils";
import { linkArchivo } from "@/lib/archivo-link";

export interface OcClienteDatos {
  id: string;
  ocCliente: string;
  ocClienteFecha: string;
  archivoUrl: string;
  archivoNombre: string;
  notasInternas: string;
}

export function OcClienteBloque({ pr, sociedadId, usuario, onGuardado }: {
  pr: OcClienteDatos;
  sociedadId?: string;
  usuario?: string;
  onGuardado: (cambios: Partial<OcClienteDatos>) => void | Promise<void>;
}) {
  const { toast } = useToast();
  const [editando, setEditando] = useState(false);
  const [numero, setNumero] = useState("");
  const [fecha, setFecha] = useState("");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [sugerido, setSugerido] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const exOcs = (pr.notasInternas || "").split("\n").filter((l) => l.startsWith("EX OC:"));
  const hayAlgo = !!(pr.ocCliente || pr.ocClienteFecha || pr.archivoUrl);

  function abrir() {
    setNumero(pr.ocCliente); setFecha(pr.ocClienteFecha); setArchivo(null); setSugerido(false); setEditando(true);
  }

  async function elegirArchivo(f: File | null) {
    setArchivo(f);
    if (!f || !/pdf|image\/(png|jpeg|webp)/.test(f.type)) return;
    setLeyendo(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch("/api/leer-oc-cliente", { method: "POST", body: fd });
      const d = await res.json();
      // Solo completa lo que está vacío: nunca pisa lo que ya escribió el vendedor.
      if (d.numero && !numero.trim()) { setNumero(d.numero); setSugerido(true); }
      if (d.fecha && !fecha) { setFecha(d.fecha); setSugerido(true); }
    } catch { /* es solo una sugerencia */ }
    setLeyendo(false);
  }

  async function guardar() {
    setGuardando(true);
    try {
      const nuevo = numero.trim();
      const cambios: Record<string, unknown> = { oc_cliente: nuevo || null, oc_cliente_fecha: fecha || null };
      let notas = pr.notasInternas || "";
      if (pr.ocCliente && nuevo !== pr.ocCliente) {
        const quien = usuario ? ` por ${usuario}` : "";
        notas = `${notas ? `${notas}\n` : ""}EX OC: ${pr.ocCliente} (reemplazada el ${formatDate(todayAR())}${quien})`;
        cambios.notas_internas = notas;
      }
      let url = pr.archivoUrl, nombre = pr.archivoNombre;
      if (archivo) {
        const path = `pr/${pr.id}/${archivo.name}`;
        const { error: upErr } = await supabase.storage.from("presupuestos").upload(path, archivo, { upsert: true });
        if (upErr) { toast.error("Error al subir el archivo"); return; }
        url = linkArchivo("presupuestos", path);
        nombre = archivo.name;
        cambios.archivo_url = url; cambios.archivo_nombre = nombre;
      }
      let q = (supabase as any).from("presupuestos").update(cambios).eq("id", pr.id);
      if (sociedadId) q = q.eq("sociedad_id", sociedadId);
      const { data, error } = await q.select("id").maybeSingle();
      if (error || !data) { toast.error(`No se pudo guardar la OC${error?.message ? `: ${error.message}` : ". Verificá tus permisos y la sociedad activa."}`); return; }
      await onGuardado({ ocCliente: nuevo, ocClienteFecha: fecha, archivoUrl: url, archivoNombre: nombre, notasInternas: notas });
      setEditando(false);
      toast.success(pr.ocCliente && nuevo !== pr.ocCliente ? `OC actualizada. La anterior quedó como EX OC: ${pr.ocCliente}` : "OC del cliente guardada");
    } finally {
      setGuardando(false);
    }
  }

  async function quitarArchivo() {
    const path = `pr/${pr.id}/${pr.archivoNombre}`;
    await supabase.storage.from("presupuestos").remove([path]);
    let q = (supabase as any).from("presupuestos").update({ archivo_url: null, archivo_nombre: null }).eq("id", pr.id);
    if (sociedadId) q = q.eq("sociedad_id", sociedadId);
    await q;
    await onGuardado({ archivoUrl: "", archivoNombre: "" });
    toast.success("Archivo eliminado");
  }

  const campo = "mt-0.5 w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white";

  return (
    <div className="col-span-2">
      <p className="text-xs text-zinc-500">OC del cliente</p>
      {!editando ? (
        hayAlgo ? (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            {pr.ocCliente && <span className="font-mono text-sm font-medium text-blue-600 dark:text-blue-400">{pr.ocCliente}</span>}
            {pr.ocClienteFecha && <span className="text-sm text-zinc-600 dark:text-zinc-300">del {formatDate(pr.ocClienteFecha)}</span>}
            {pr.archivoUrl && (
              <a href={pr.archivoUrl} target="_blank" rel="noopener noreferrer" className="flex max-w-[200px] items-center gap-1 truncate text-sm text-blue-600 hover:underline dark:text-blue-400">
                <FileText className="h-3.5 w-3.5 shrink-0" />{pr.archivoNombre || "Abrir archivo"}
              </a>
            )}
            <button onClick={abrir} className="flex items-center gap-1 text-xs text-orange-500 underline underline-offset-2 hover:text-orange-600" title="Cambiar la OC del cliente">
              <Pencil className="h-3 w-3" /> Editar
            </button>
            {pr.archivoUrl && (
              <button onClick={quitarArchivo} className="text-red-400 hover:text-red-600" title="Quitar el archivo"><Trash2 className="h-3 w-3" /></button>
            )}
          </div>
        ) : (
          <button onClick={abrir} className="mt-0.5 text-sm text-orange-500 underline underline-offset-2 hover:text-orange-600">+ Cargar OC (número, fecha y archivo)</button>
        )
      ) : (
        <div className="mt-1 space-y-2 rounded-lg border border-zinc-200 p-2 dark:border-zinc-700">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-zinc-400">Número {sugerido && numero && <span className="text-orange-500"><Sparkles className="inline h-3 w-3" /> sugerido, revisalo</span>}</label>
              <input value={numero} onChange={(e) => { setNumero(e.target.value); setSugerido(false); }} placeholder="Número de OC" className={`${campo} font-mono`} />
            </div>
            <div>
              <label className="text-[11px] text-zinc-400">Fecha de la OC</label>
              <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={campo} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex cursor-pointer items-center gap-1 text-sm text-zinc-500 hover:text-orange-600">
              <Upload className="h-3.5 w-3.5" />
              <span className="max-w-[220px] truncate">{archivo ? archivo.name : pr.archivoNombre ? "Cambiar archivo" : "Subir archivo (PDF o imagen)"}</span>
              <input type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => { void elegirArchivo(e.target.files?.[0] || null); e.target.value = ""; }} />
            </label>
            {leyendo && <span className="flex items-center gap-1 text-xs text-zinc-400"><Loader2 className="h-3 w-3 animate-spin" /> Leyendo el número…</span>}
          </div>
          <div className="flex gap-2">
            <button onClick={guardar} disabled={guardando || leyendo} className="rounded-lg bg-orange-500 px-3 py-1 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50">
              {guardando ? "Guardando…" : "Guardar"}
            </button>
            <button onClick={() => setEditando(false)} disabled={guardando} className="rounded-lg border border-zinc-300 px-3 py-1 text-sm text-zinc-600 dark:border-zinc-600 dark:text-zinc-300">Cancelar</button>
          </div>
        </div>
      )}
      {exOcs.map((l, k) => <p key={k} className="mt-0.5 font-mono text-[11px] text-zinc-400">{l}</p>)}
    </div>
  );
}
