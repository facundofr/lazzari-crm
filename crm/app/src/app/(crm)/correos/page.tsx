"use client";

// Correos enviados (Augusto 28/10/2026): cada mail que salió del CRM con su estado verificado en Resend.
// Cada usuario ve los suyos; admin y super admin pueden ver los de todos. Al entrar se verifican los pendientes.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { Card } from "@/components/ui/card";
import { useUser } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase/client";
import { fechaHoraAR } from "@/lib/presupuesto-envios";
import { ETIQUETA_ESTADO, nombreDocumento, type EstadoMail, type MailEnviado } from "@/lib/correos-enviados";
import { MailCheck, RefreshCw, Search } from "lucide-react";

const COLOR_ESTADO: Record<EstadoMail, string> = {
  entregado: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
  rebotado: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400",
  spam: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400",
  demorado: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
  enviado: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
};

const LINK_DOC: Record<string, string> = { presupuesto: "/presupuestos", remito: "/remitos", orden_compra: "/compras-lazza", factura: "/facturas", aviso_cobranza: "/cobranzas" };

export default function CorreosPage() {
  const { profile, role } = useUser();
  const esAdmin = role === "admin" || role === "super_admin";
  const [mails, setMails] = useState<MailEnviado[]>([]);
  const [usuarios, setUsuarios] = useState<{ id: string; full_name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [verificando, setVerificando] = useState(false);
  const [quien, setQuien] = useState<string>(""); // "" = los míos; "todos" = todos (admin)
  const [estado, setEstado] = useState<"" | EstadoMail>("");
  const [buscar, setBuscar] = useState("");

  const cargar = useCallback(async () => {
    if (!profile?.id) return;
    let q = (supabase as any).from("mails_enviados")
      .select("id, enviado_at, enviado_por, remitente, enviado_a, asunto, documento_tipo, documento_id, documento_nombre, estado, estado_at, verificado_at")
      .order("enviado_at", { ascending: false }).limit(500);
    const de = quien === "todos" && esAdmin ? null : quien && esAdmin ? quien : profile.id;
    if (de) q = q.eq("enviado_por", de);
    const { data } = await q;
    setMails((data || []) as MailEnviado[]);
    setLoading(false);
  }, [profile?.id, quien, esAdmin]);

  // Al entrar: lista, y después se verifican en Resend los que no tienen estado final.
  const verificar = useCallback(async () => {
    setVerificando(true);
    try {
      await fetch("/api/email/verificar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ todos: esAdmin && quien !== "" }) });
    } catch { /* se ve lo que hay */ }
    await cargar();
    setVerificando(false);
  }, [cargar, esAdmin, quien]);

  useEffect(() => { cargar().then(verificar); }, [cargar]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!esAdmin) return;
    (supabase as any).from("profiles").select("id, full_name").order("full_name").then(({ data }: any) => setUsuarios(data || []));
  }, [esAdmin]);

  const nombre = (id: string | null) => (id === profile?.id ? "Vos" : usuarios.find(u => u.id === id)?.full_name || "—");
  const filtrados = useMemo(() => {
    const t = buscar.trim().toLowerCase();
    return mails.filter(m => (!estado || m.estado === estado)
      && (!t || [m.enviado_a, m.asunto, m.documento_nombre, m.remitente].some(x => String(x || "").toLowerCase().includes(t))));
  }, [mails, estado, buscar]);
  const cuenta = (e: EstadoMail) => mails.filter(m => m.estado === e).length;

  return (
    <>
      <Header title="Correos enviados" subtitle="Cada mail que salió del CRM y si llegó" />
      <div className="p-3 sm:p-4">
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <MailCheck className="h-5 w-5 text-zinc-500" />
            <p className="text-xs text-zinc-500">
              {cuenta("entregado")} entregados · <span className={cuenta("rebotado") + cuenta("spam") ? "font-semibold text-red-600" : ""}>{cuenta("rebotado") + cuenta("spam")} no llegaron</span> · {cuenta("enviado") + cuenta("demorado")} sin confirmar todavía
            </p>
            <button onClick={verificar} disabled={verificando} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 h-8 px-3 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
              <RefreshCw className={`h-4 w-4 ${verificando ? "animate-spin" : ""}`} /> {verificando ? "Verificando…" : "Verificar ahora"}
            </button>
          </div>
          <div className="grid gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800 md:grid-cols-[minmax(0,1fr)_180px_200px_auto] md:items-center">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar por mail, asunto o documento..."
                className="w-full rounded-lg border border-zinc-300 bg-white h-8 py-1 pl-9 pr-3 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:focus:ring-orange-950" />
            </label>
            <select value={estado} onChange={(e) => setEstado(e.target.value as "" | EstadoMail)} className="rounded-lg border border-zinc-300 bg-white h-8 px-3 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
              <option value="">Todos los estados</option>
              {(Object.keys(ETIQUETA_ESTADO) as EstadoMail[]).map(e => <option key={e} value={e}>{ETIQUETA_ESTADO[e]}</option>)}
            </select>
            {esAdmin ? (
              <select value={quien} onChange={(e) => { setLoading(true); setQuien(e.target.value); }} className="rounded-lg border border-zinc-300 bg-white h-8 px-3 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
                <option value="">Mis correos</option>
                <option value="todos">Todos los usuarios</option>
                {usuarios.filter(u => u.id !== profile?.id).map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
              </select>
            ) : <span className="text-sm text-zinc-500">Mis correos</span>}
            <span className="text-sm text-zinc-500">{filtrados.length} de {mails.length}</span>
          </div>
          {loading ? <p className="p-4 text-sm text-zinc-500">Cargando...</p> : filtrados.length === 0 ? (
            <p className="p-4 text-sm text-zinc-500">{mails.length ? "No hay correos que coincidan." : "Todavía no hay correos registrados. Se anotan desde el 28/10/2026."}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-800">
                  <tr><th className="px-3 py-1.5">Fecha</th><th className="px-3 py-1.5">Documento</th><th className="px-3 py-1.5">Para</th>{(quien !== "" && esAdmin) && <th className="px-3 py-1.5">Lo mandó</th>}<th className="px-3 py-1.5">Estado</th></tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {filtrados.map(m => (
                    <tr key={m.id}>
                      <td className="whitespace-nowrap px-3 py-1.5 text-xs text-zinc-600 dark:text-zinc-300">{fechaHoraAR(m.enviado_at)}</td>
                      <td className="px-3 py-1.5" title={m.asunto || ""}>
                        {LINK_DOC[m.documento_tipo || ""] ? <Link href={LINK_DOC[m.documento_tipo || ""]} className="font-medium text-orange-600 hover:underline">{nombreDocumento(m)}</Link> : <span className="font-medium dark:text-white">{nombreDocumento(m)}</span>}
                        {m.asunto && <p className="max-w-[320px] truncate text-[11px] text-zinc-400">{m.asunto}</p>}
                      </td>
                      <td className="max-w-[260px] truncate px-3 py-1.5 text-xs dark:text-zinc-300" title={m.enviado_a}>{m.enviado_a}</td>
                      {(quien !== "" && esAdmin) && <td className="whitespace-nowrap px-3 py-1.5 text-xs dark:text-zinc-300">{nombre(m.enviado_por)}</td>}
                      <td className="whitespace-nowrap px-3 py-1.5">
                        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${COLOR_ESTADO[m.estado]}`} title={m.verificado_at ? `Verificado el ${fechaHoraAR(m.verificado_at)}` : "Todavía no se verificó"}>{ETIQUETA_ESTADO[m.estado]}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
