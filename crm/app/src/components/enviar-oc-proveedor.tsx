"use client";

/**
 * Enviar OC al proveedor: WhatsApp, mail (con el PDF) o copiar.
 * Se propone sola al aprobar un PR (con las OC que generó) y también se abre desde Compras.
 * El WhatsApp y el mail salen del contacto principal del proveedor; si falta, se escribe acá y se puede guardar.
 * Es una sugerencia: cerrar sin enviar no frena nada.
 */
import { useEffect, useState } from "react";
import { X, Loader2, Mail, MessageCircle, ClipboardCopy, Check, Download, Save } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useUser } from "@/lib/auth-context";
import { useToast } from "@/components/ui/toast";
import { EmailComposeModal } from "@/components/email-compose-modal";
import { loadEmailTemplate, applyTemplateVars } from "@/lib/email-templates";
import { htmlToPdfBase64, openPDFWindow } from "@/lib/pdf-templates";
import { formatCurrency, formatDate } from "@/lib/utils";
import { avisoNumeroOC, textoOCParaProveedor, linkWhatsAppOC, htmlOCParaProveedor, cuerpoMailConAviso, type OCEnvio, type OCEnvioItem } from "@/lib/oc-envio";

const db = supabase as any;

interface Fila {
  id: string;
  proveedorId: string;
  oc: OCEnvio;
  items: OCEnvioItem[];
  whatsapp: string;
  email: string;
  /** Lo que había guardado, para saber si hay algo nuevo para guardar en el proveedor. */
  guardado: { whatsapp: string; email: string; contactoId: string | null };
  pedido: boolean;
  enviadoPor: string[];
}

export default function EnviarOCProveedor({ ocIds, titulo, onClose }: { ocIds: string[]; titulo?: string; onClose: () => void }) {
  const { sociedadActiva, profile } = useUser();
  const { toast } = useToast();
  const [filas, setFilas] = useState<Fila[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [copiada, setCopiada] = useState<string | null>(null);
  const [mail, setMail] = useState<{ fila: Fila; subject: string; body: string } | null>(null);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        if (!ocIds.length) { setFilas([]); return; }
        const [{ data: ocs, error: e1 }, { data: items, error: e2 }] = await Promise.all([
          db.from("ordenes_compra")
            .select("id, numero, fecha, fecha_entrega_estimada, estado, moneda, subtotal, iva, total, observaciones, pedido, proveedor_id, proveedores(razon_social, cuit, email, telefono, direccion, localidad, provincia, forma_pago, condicion_iva), presupuesto_origen:presupuesto_origen_id(numero)")
            .in("id", ocIds),
          db.from("orden_compra_items").select("orden_id, codigo, descripcion, cantidad, unidad, precio_unitario, subtotal, orden").in("orden_id", ocIds).order("orden"),
        ]);
        if (e1 || e2) throw e1 || e2;
        const provIds = [...new Set((ocs || []).map((o: any) => o.proveedor_id).filter(Boolean))];
        const { data: contactos } = provIds.length
          ? await db.from("contactos").select("id, entity_id, whatsapp, telefono, email, principal").eq("entity_type", "proveedor").in("entity_id", provIds).order("principal", { ascending: false })
          : { data: [] };
        const out: Fila[] = (ocs || []).filter((o: any) => o.proveedor_id).map((o: any) => {
          const cs = (contactos || []).filter((c: any) => c.entity_id === o.proveedor_id);
          const conWa = cs.find((c: any) => c.whatsapp) || cs.find((c: any) => c.telefono);
          const conMail = cs.find((c: any) => c.email);
          const whatsapp = String(conWa?.whatsapp || conWa?.telefono || o.proveedores?.telefono || "");
          const email = String(conMail?.email || o.proveedores?.email || "");
          return {
            id: o.id, proveedorId: o.proveedor_id, pedido: !!o.pedido, enviadoPor: [],
            whatsapp, email, guardado: { whatsapp, email, contactoId: (cs[0]?.id as string) || null },
            oc: { ...o, proveedor: { ...(o.proveedores || {}), razon_social: o.proveedores?.razon_social || "Proveedor" } },
            items: (items || []).filter((it: any) => it.orden_id === o.id),
          };
        });
        if (!cancelado) setFilas(out.sort((a, b) => a.oc.proveedor.razon_social.localeCompare(b.oc.proveedor.razon_social)));
      } catch (e: any) {
        if (!cancelado) setError(e?.message || "No se pudieron traer las OC");
      } finally {
        if (!cancelado) setCargando(false);
      }
    })();
    return () => { cancelado = true; };
  }, [ocIds]);

  const actualizar = (id: string, patch: Partial<Fila>) => setFilas((p) => p.map((f) => (f.id === id ? { ...f, ...patch } : f)));

  async function marcarPedida(f: Fila, medio: string) {
    actualizar(f.id, { enviadoPor: [...new Set([...f.enviadoPor, medio])] });
    if (f.pedido) return;
    const { error: e } = await db.from("ordenes_compra").update({ pedido: true }).eq("id", f.id).eq("sociedad_id", sociedadActiva?.id);
    if (!e) actualizar(f.id, { pedido: true, enviadoPor: [...new Set([...f.enviadoPor, medio])] });
  }

  async function desmarcarPedida(f: Fila) {
    const { error: e } = await db.from("ordenes_compra").update({ pedido: false }).eq("id", f.id).eq("sociedad_id", sociedadActiva?.id);
    if (!e) actualizar(f.id, { pedido: false, enviadoPor: [] });
  }

  function enviarWhatsApp(f: Fila) {
    const link = linkWhatsAppOC(f.whatsapp, textoOCParaProveedor(f.oc, f.items));
    if (!link) { toast.error("El número de WhatsApp no parece válido: revisalo (con característica, ej. 11 5555-1234)."); return; }
    window.open(link, "_blank", "noopener");
    void marcarPedida(f, "WhatsApp");
  }

  async function abrirMail(f: Fila) {
    const template = await loadEmailTemplate("orden_compra", sociedadActiva?.id || "");
    const vars = { numero: f.oc.numero, sociedad: sociedadActiva?.razonSocial || "Lazzari", total: formatCurrency(Number(f.oc.total), f.oc.moneda === "USD" ? "USD" : "ARS"), fecha: formatDate(f.oc.fecha), proveedor: f.oc.proveedor.razon_social };
    setMail({ fila: f, subject: applyTemplateVars(template.asunto, vars), body: cuerpoMailConAviso(applyTemplateVars(template.cuerpo, vars), f.oc.numero) });
  }

  async function copiar(f: Fila) {
    await navigator.clipboard.writeText(textoOCParaProveedor(f.oc, f.items));
    setCopiada(f.id);
    setTimeout(() => setCopiada(null), 2000);
  }

  function pdf(f: Fila) {
    if (!sociedadActiva) return;
    openPDFWindow(htmlOCParaProveedor(f.oc, f.items, sociedadActiva), `${f.oc.numero}.pdf`);
  }

  /** Guarda el WhatsApp y el mail escritos acá en el contacto principal del proveedor (o crea uno). */
  async function guardarContacto(f: Fila) {
    const datos = { whatsapp: f.whatsapp.trim() || null, email: f.email.trim() || null };
    const r = f.guardado.contactoId
      ? await db.from("contactos").update(datos).eq("id", f.guardado.contactoId).eq("entity_id", f.proveedorId)
      : await db.from("contactos").insert({ ...datos, nombre: "Compras", principal: true, entity_type: "proveedor", entity_id: f.proveedorId }).select("id").single();
    if (r.error) { toast.error("No se pudo guardar el contacto"); return; }
    const contactoId = f.guardado.contactoId || r.data?.id || null;
    // Las demás OC del mismo proveedor toman el mismo contacto.
    setFilas((p) => p.map((x) => x.proveedorId === f.proveedorId
      ? { ...x, whatsapp: f.whatsapp, email: f.email, guardado: { whatsapp: f.whatsapp, email: f.email, contactoId } } : x));
    toast.success(`Contacto guardado en ${f.oc.proveedor.razon_social}`);
  }

  const input = "w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-900";

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/50 p-4">
      <div className="w-full max-w-4xl rounded-xl bg-white shadow-2xl dark:bg-zinc-900">
        <div className="flex items-start justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-700">
          <div>
            <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">{titulo || "Enviar OC al proveedor"}</h2>
            <p className="text-xs text-zinc-500">Mandala por WhatsApp o por mail (va con el PDF). Al enviarla queda marcada como pedida. Cada OC pide que la factura traiga su número.</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800" title="Cerrar"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-3 px-5 py-4">
          {cargando && <p className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Trayendo las OC…</p>}
          {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">{error}</p>}
          {!cargando && !error && !filas.length && <p className="text-sm text-zinc-500">No hay OC con proveedor para enviar.</p>}
          {filas.map((f) => {
            const cambio = f.whatsapp.trim() !== f.guardado.whatsapp.trim() || f.email.trim() !== f.guardado.email.trim();
            const waOk = !!linkWhatsAppOC(f.whatsapp, "x");
            return (
              <div key={f.id} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
                <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="font-mono font-semibold">{f.oc.numero}</span>
                  <span className="font-semibold">{f.oc.proveedor.razon_social}</span>
                  <span className="text-zinc-500">{f.items.length} renglón(es) · {formatCurrency(Number(f.oc.total), f.oc.moneda === "USD" ? "USD" : "ARS")}</span>
                  {f.pedido
                    ? <span className="ml-auto flex items-center gap-1 text-xs text-emerald-600"><Check className="h-3.5 w-3.5" /> Pedida{f.enviadoPor.length ? ` por ${f.enviadoPor.join(" y ")}` : ""} <button onClick={() => desmarcarPedida(f)} className="ml-1 text-zinc-400 underline">deshacer</button></span>
                    : <span className="ml-auto text-xs text-amber-600">Sin enviar</span>}
                </div>
                <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                  <label className="text-xs text-zinc-500">WhatsApp
                    <input value={f.whatsapp} onChange={(e) => actualizar(f.id, { whatsapp: e.target.value })} placeholder="Ej. 11 5555-1234" className={input} inputMode="tel" />
                  </label>
                  <label className="text-xs text-zinc-500">Mail
                    <input value={f.email} onChange={(e) => actualizar(f.id, { email: e.target.value })} placeholder="compras@proveedor.com" className={input} inputMode="email" />
                  </label>
                  <div className="flex items-end">
                    {cambio && (f.whatsapp.trim() || f.email.trim()) && (
                      <button onClick={() => guardarContacto(f)} className="flex items-center gap-1 rounded-lg border border-zinc-300 px-2 py-1.5 text-xs dark:border-zinc-600" title="Guardar este WhatsApp y mail en el contacto principal del proveedor">
                        <Save className="h-3.5 w-3.5" /> Guardar en el proveedor
                      </button>
                    )}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button disabled={!waOk} onClick={() => enviarWhatsApp(f)} title={waOk ? "Abre WhatsApp con la OC escrita" : "Falta un número de WhatsApp válido"}
                    className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40"><MessageCircle className="h-4 w-4" /> WhatsApp</button>
                  <button onClick={() => abrirMail(f)} className="flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-600"><Mail className="h-4 w-4" /> Mail con PDF</button>
                  <button onClick={() => copiar(f)} className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-600">
                    {copiada === f.id ? <><Check className="h-4 w-4 text-emerald-600" /> Copiada</> : <><ClipboardCopy className="h-4 w-4" /> Copiar</>}
                  </button>
                  <button onClick={() => pdf(f)} className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-600"><Download className="h-4 w-4" /> PDF</button>
                </div>
                <p className="mt-2 text-[11px] font-medium text-orange-700 dark:text-orange-400">⚠️ {avisoNumeroOC(f.oc.numero)}</p>
              </div>
            );
          })}
        </div>

        <div className="flex justify-end border-t border-zinc-200 px-5 py-3 dark:border-zinc-700">
          <button onClick={onClose} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-600">{filas.length && filas.every((f) => f.pedido) ? "Listo" : "Después"}</button>
        </div>
      </div>

      {mail && (
        <EmailComposeModal
          open
          onClose={() => setMail(null)}
          documentType="orden_compra"
          sociedadId={sociedadActiva?.id}
          userEmail={profile?.email ? `${profile.full_name || "Lazzari"} <${profile.email}>` : undefined}
          defaultTo={mail.fila.email}
          defaultSubject={mail.subject}
          defaultBody={mail.body}
          pdfFilename={`${mail.fila.oc.numero}.pdf`}
          generatePdf={async () => {
            if (!sociedadActiva) throw new Error("Seleccioná una sociedad");
            return htmlToPdfBase64(htmlOCParaProveedor(mail.fila.oc, mail.fila.items, sociedadActiva));
          }}
          onSuccess={() => { void marcarPedida(mail.fila, "mail"); }}
        />
      )}
    </div>
  );
}
