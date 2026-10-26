"use client";

// Configuración > Integraciones: prender o apagar el agente de correo (26/10/2026, Augusto: "desconectemos el agente").
// Guarda la fila `agente_mail_activo` de `configuracion` (sin sociedad). Sin la fila, el agente está apagado (lib/agente-mail-server).
import { useEffect, useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const CLAVE = "agente_mail_activo";

export function AgenteMailInterruptor() {
  const [activo, setActivo] = useState<boolean | null>(null);
  const [guardando, setGuardando] = useState(false);
  const db = supabase as any;

  useEffect(() => {
    db.from("configuracion").select("value").eq("key", CLAVE).is("sociedad_id", null).maybeSingle()
      .then(({ data }: { data: { value: unknown } | null }) => setActivo(data?.value === true));
  }, []);

  async function cambiar() {
    const nuevo = !activo;
    if (!confirm(nuevo
      ? "¿Prender el agente de correo? Vuelve a leer administracion@ 3 veces por día hábil (usa IA)."
      : "¿Apagar el agente de correo? Deja de leer los mails nuevos de administracion@. Lo que ya leyó queda guardado.")) return;
    setGuardando(true);
    // La fila no tiene sociedad: el índice único (sociedad_id, key) no la encuentra con upsert, así que se busca y se actualiza o se crea.
    const { data: fila } = await db.from("configuracion").select("id").eq("key", CLAVE).is("sociedad_id", null).maybeSingle();
    const { error } = fila
      ? await db.from("configuracion").update({ value: nuevo, updated_at: new Date().toISOString() }).eq("id", fila.id)
      : await db.from("configuracion").insert({ key: CLAVE, value: nuevo, sociedad_id: null });
    setGuardando(false);
    if (error) { alert(`No se pudo guardar: ${error.message}`); return; }
    setActivo(nuevo);
  }

  return (
    <Card className="flex items-start gap-3 p-3">
      <div className={`rounded-lg p-2 ${activo ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30" : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800"}`}>
        <Mail className="h-5 w-5" />
      </div>
      <div className="flex-1">
        <div className="flex items-center justify-between gap-2">
          <h4 className="font-medium text-zinc-900 dark:text-white">IA — Agente de correo</h4>
          <Badge variant={activo ? "success" : "outline"}>{activo === null ? "…" : activo ? "Prendido" : "Apagado"}</Badge>
        </div>
        <p className="mt-1 text-sm text-zinc-500">Lee los mails de administracion@ 3 veces por día hábil y los resume.</p>
        <button type="button" disabled={activo === null || guardando} onClick={() => void cambiar()}
          className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 text-xs font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
          {guardando && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {activo ? "Apagar" : "Prender"}
        </button>
      </div>
    </Card>
  );
}
