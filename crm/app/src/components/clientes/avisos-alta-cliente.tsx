"use client";

// Avisos del alta / edición de cliente. Son SOLO avisos: nunca bloquean el guardado.
//  - Posibles duplicados por CUIT o por razón social parecida, en todas las sociedades que el usuario puede leer.
//  - Último informe BCRA guardado para ese CUIT (si existe en cualquier sociedad). Solo lectura.

import { useEffect, useState } from "react";
import { AlertTriangle, ExternalLink, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { SEMAFORO_LABEL, SITUACION_LABEL, type Semaforo } from "@/lib/bcra";

export interface ClienteParecido {
  id: string;
  razon_social: string;
  cuit: string | null;
  sociedad_id: string | null;
  porCuit: boolean;
}

/** "20379309128" → "20-37930912-8" */
function cuitConGuiones(d: string): string {
  return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : d;
}

export function AvisoDuplicadosCliente({
  cuit,
  razonSocial,
  excluirId,
  sociedades,
  onAbrir,
}: {
  cuit: string;
  razonSocial: string;
  excluirId: string | null;
  sociedades: { id: string; nombre: string }[];
  onAbrir?: (c: ClienteParecido) => void;
}) {
  const [parecidos, setParecidos] = useState<ClienteParecido[]>([]);
  const [buscando, setBuscando] = useState(false);
  const cuitDig = cuit.replace(/\D/g, "");
  const nombre = razonSocial.trim();

  useEffect(() => {
    const buscarCuit = cuitDig.length === 11;
    const buscarNombre = nombre.length >= 4;
    if (!buscarCuit && !buscarNombre) { setParecidos([]); return; }
    let cancelado = false;
    const t = setTimeout(async () => {
      setBuscando(true);
      try {
        const db = supabase as any;
        const consultas: Promise<{ data: any[] | null }>[] = [];
        if (buscarCuit) {
          consultas.push(
            db.from("clientes").select("id, razon_social, cuit, sociedad_id")
              .in("cuit", [cuitDig, cuitConGuiones(cuitDig)]).limit(5),
          );
        }
        if (buscarNombre) {
          const patron = `%${nombre.replace(/[%_]/g, " ")}%`;
          consultas.push(
            db.from("clientes").select("id, razon_social, cuit, sociedad_id")
              .ilike("razon_social", patron).limit(5),
          );
        }
        const res = await Promise.all(consultas);
        if (cancelado) return;
        const vistos = new Map<string, ClienteParecido>();
        res.forEach((r, i) => {
          const porCuit = buscarCuit && i === 0;
          for (const c of r.data || []) {
            if (!c?.id || c.id === excluirId) continue;
            const mismoCuit = buscarCuit && String(c.cuit || "").replace(/\D/g, "") === cuitDig;
            const prev = vistos.get(c.id);
            vistos.set(c.id, { id: c.id, razon_social: c.razon_social || "", cuit: c.cuit, sociedad_id: c.sociedad_id, porCuit: porCuit || mismoCuit || !!prev?.porCuit });
          }
        });
        setParecidos([...vistos.values()].sort((a, b) => Number(b.porCuit) - Number(a.porCuit)).slice(0, 6));
      } catch {
        if (!cancelado) setParecidos([]);
      } finally {
        if (!cancelado) setBuscando(false);
      }
    }, 400);
    return () => { cancelado = true; clearTimeout(t); };
  }, [cuitDig, nombre, excluirId]);

  if (parecidos.length === 0) {
    return buscando ? (
      <p className="flex items-center gap-1.5 text-xs text-zinc-400"><Loader2 className="h-3 w-3 animate-spin" /> Buscando clientes parecidos…</p>
    ) : null;
  }

  const nombreSociedad = (id: string | null) => sociedades.find((s) => s.id === id)?.nombre || "otra sociedad";

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
      <p className="flex items-center gap-1.5 font-medium">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        {parecidos.some((p) => p.porCuit) ? "Ya existe un cliente con este CUIT" : "Hay clientes con un nombre parecido"}
        <span className="font-normal text-xs text-amber-700/80 dark:text-amber-400/80">(es solo un aviso, podés guardar igual)</span>
      </p>
      <ul className="mt-1 space-y-0.5">
        {parecidos.map((p) => (
          <li key={p.id} className="flex items-center gap-2 text-xs">
            <span className="truncate">
              Ya existe: <b>{p.razon_social}</b>{p.cuit ? ` (${p.cuit})` : ""} en {nombreSociedad(p.sociedad_id)}
            </span>
            {onAbrir && (
              <button type="button" onClick={() => onAbrir(p)} className="inline-flex shrink-0 items-center gap-0.5 font-medium underline hover:no-underline">
                Abrir <ExternalLink className="h-3 w-3" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

const SEMAFORO_CLASES: Record<Semaforo, string> = {
  verde: "border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300",
  amarillo: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300",
  rojo: "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300",
  gris: "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400",
};
const SEMAFORO_PUNTO: Record<Semaforo, string> = { verde: "bg-green-500", amarillo: "bg-amber-500", rojo: "bg-red-500", gris: "bg-zinc-400" };

/**
 * Semáforo BCRA para un CUIT de 11 números: muestra el último informe ya guardado para ese CUIT
 * (en cualquier cliente/sociedad que el usuario pueda leer). No consulta ni guarda nada nuevo:
 * la consulta en vivo se hace desde la Ficha 360 del cliente una vez creado.
 */
export function SemaforoBCRAPrevio({ cuit }: { cuit: string }) {
  const cuitDig = cuit.replace(/\D/g, "");
  const [estado, setEstado] = useState<{ cargando: boolean; fila: any | null }>({ cargando: false, fila: null });

  useEffect(() => {
    if (cuitDig.length !== 11) { setEstado({ cargando: false, fila: null }); return; }
    let cancelado = false;
    setEstado({ cargando: true, fila: null });
    const t = setTimeout(async () => {
      try {
        const { data } = await (supabase as any)
          .from("cliente_bcra_informes")
          .select("semaforo, peor_situacion, deuda_total, entidades, cheques_sin_pagar, mes, error")
          .eq("cuit", cuitDig)
          .order("consultado_at", { ascending: false })
          .limit(1);
        let fila = (data && data[0]) || null;
        // Sin informe guardado: consulta en vivo, sin guardar nada.
        if (!fila) {
          const res = await fetch(`/api/bcra/preview?cuit=${cuitDig}`);
          if (res.ok) fila = await res.json();
        }
        if (!cancelado) setEstado({ cargando: false, fila });
      } catch {
        if (!cancelado) setEstado({ cargando: false, fila: null });
      }
    }, 400);
    return () => { cancelado = true; clearTimeout(t); };
  }, [cuitDig]);

  if (cuitDig.length !== 11) return null;
  if (estado.cargando) return <p className="flex items-center gap-1.5 text-xs text-zinc-400"><Loader2 className="h-3 w-3 animate-spin" /> BCRA…</p>;
  const f = estado.fila;
  if (!f) {
    return <p className="text-xs text-zinc-400">BCRA: no se pudo consultar ahora. Probá de nuevo desde la Ficha 360 una vez guardado.</p>;
  }
  const sem: Semaforo = (["verde", "amarillo", "rojo", "gris"] as const).includes(f.semaforo) ? f.semaforo : "gris";
  const detalle = f.error
    ? "no se pudo consultar"
    : [
        f.peor_situacion ? `situación ${f.peor_situacion} (${SITUACION_LABEL[f.peor_situacion] || "?"})` : "sin deudas informadas",
        f.entidades ? `${f.entidades} entidad(es)` : null,
        f.cheques_sin_pagar ? `${f.cheques_sin_pagar} cheque(s) sin pagar` : null,
      ].filter(Boolean).join(" · ");
  return (
    <div className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1 text-xs ${SEMAFORO_CLASES[sem]}`}>
      <span className={`h-2.5 w-2.5 rounded-full ${SEMAFORO_PUNTO[sem]}`} />
      <span><b>BCRA {SEMAFORO_LABEL[sem]}</b> · {detalle} <span className="opacity-70">({f.mes ? `informe ${f.mes}` : "consulta en vivo"})</span></span>
    </div>
  );
}
