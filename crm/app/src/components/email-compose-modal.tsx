"use client";

import { useState } from "react";
import { X, Send, Loader2, Paperclip, AlertTriangle, CheckCircle2, CheckCheck, Maximize2, Minimize2, UserPlus } from "lucide-react";
import { supabase } from "@/lib/supabase/client";

export type EmailDocumentType = "presupuesto" | "factura" | "remito" | "orden_compra" | "orden_pago" | "recibo" | "resumen_cuenta";

interface EmailComposeModalProps {
  open: boolean;
  onClose: () => void;
  documentType: EmailDocumentType;
  /** Id del documento (PR): el servidor anota cada envío. */
  documentId?: string;
  /** Pre-filled recipient email(s) */
  defaultTo?: string;
  /** Pre-filled subject */
  defaultSubject?: string;
  /** Pre-filled body HTML */
  defaultBody?: string;
  /** PDF filename hint for display */
  pdfFilename?: string;
  /** Function that generates PDF and returns base64 string. MUST be provided. */
  generatePdf: () => Promise<string>;
  /** Callback on successful send — receives Resend email ID for delivery tracking */
  /** `enviadoA`: los mails a los que salió de verdad (lo que quedó en "Para", no el sugerido al abrir). */
  onSuccess?: (emailId?: string, enviadoA?: string[]) => void | Promise<void>;
  /** Sociedad ID for sender email selection */
  sociedadId?: string;
  /** User email — used as sender for PR/remitos */
  userEmail?: string;
  /** Suggested emails from client/proveedor/contactos to show as clickable chips */
  suggestedEmails?: { email: string; label?: string }[];
  /** If provided, shows a "Marcar como enviada" button (for when sent outside the system) */
  onMarkSent?: () => void | Promise<void>;
  /** Extra file attachments (e.g. comprobantes) to include in the email */
  extraAttachments?: { filename: string; url: string }[];
  /** Si se pasa, un mail escrito a mano que no está entre los contactos se puede guardar con "Guardar este contacto". */
  guardarContacto?: { entityType: "cliente" | "proveedor"; entityId: string; cargo?: string };
  /** Aviso arriba de "Para" (ej.: quién pidió el PR de la factura). */
  aviso?: React.ReactNode;
}

/** Cuántos contactos se muestran arriba; el resto queda detrás de "Ver todos". */
const SUGERIDOS_VISIBLES = 3;

const DOC_LABELS: Record<EmailDocumentType, string> = {
  presupuesto: "Presupuesto",
  factura: "Factura",
  remito: "Remito",
  orden_compra: "Orden de compra",
  orden_pago: "Orden de pago",
  recibo: "Recibo",
  resumen_cuenta: "Resumen de cuenta",
};

export function EmailComposeModal({
  open,
  onClose,
  documentType,
  documentId,
  defaultTo = "",
  defaultSubject = "",
  defaultBody = "",
  pdfFilename = "",
  generatePdf,
  onSuccess,
  sociedadId,
  userEmail,
  suggestedEmails = [],
  onMarkSent,
  extraAttachments = [],
  guardarContacto,
  aviso,
}: EmailComposeModalProps) {
  const [to, setTo] = useState(defaultTo);
  const [subject, setSubject] = useState(defaultSubject);
  const [bodyHtml, setBodyHtml] = useState(defaultBody);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [prevOpen, setPrevOpen] = useState(false);
  const [verTodos, setVerTodos] = useState(false);
  const [verMensaje, setVerMensaje] = useState(false);
  const [guardados, setGuardados] = useState<string[]>([]);
  const [guardando, setGuardando] = useState("");
  // Cómo estaba al abrir: si cambia, cerrar pregunta antes (ver pedirCierre).
  const [alAbrir, setAlAbrir] = useState({ to: defaultTo, subject: defaultSubject, body: defaultBody });

  // Reset state when modal opens (transition from closed → open)
  if (open && !prevOpen) {
    setTo(defaultTo);
    setSubject(defaultSubject);
    setBodyHtml(defaultBody);
    setAlAbrir({ to: defaultTo, subject: defaultSubject, body: defaultBody });
    setResult(null);
    setSending(false);
    setVerTodos(false); setVerMensaje(false); setGuardados([]);
  }
  if (open !== prevOpen) setPrevOpen(open);

  if (!open) return null;

  // Mails escritos a mano que no están entre los contactos sugeridos ni se guardaron recién.
  const nuevos = guardarContacto
    ? to.split(/[,;]\s*/).map(e => e.trim()).filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)
        && !suggestedEmails.some(s => s.email.toLowerCase() === e.toLowerCase()) && !guardados.includes(e.toLowerCase()))
    : [];

  async function guardarEste(email: string) {
    if (!guardarContacto) return;
    setGuardando(email);
    const { error } = await (supabase as any).from("contactos").insert({
      nombre: guardarContacto.cargo || "Contacto", cargo: guardarContacto.cargo || null, email, principal: false,
      entity_type: guardarContacto.entityType, entity_id: guardarContacto.entityId,
    });
    setGuardando("");
    if (error) { setResult({ success: false, message: `No se pudo guardar el contacto: ${error.message}` }); return; }
    setGuardados(g => [...g, email.toLowerCase()]);
  }

  // 26/10/2026 (auditoría UX, arreglo 3): si cambiaste algo y todavía no se mandó, el clic afuera y la X preguntan antes de cerrar
  // (como Presupuestos). «Cancelar» cierra directo; mientras manda no se cierra.
  const hayCambios = !result?.success && (to !== alAbrir.to || subject !== alAbrir.subject || bodyHtml !== alAbrir.body);
  function pedirCierre() {
    if (sending) return;
    if (hayCambios && !confirm("¿Estás seguro que deseas salir sin mandar el mail? Se pierde lo que escribiste.")) return;
    onClose();
  }

  async function handleSend() {
    if (!to.trim()) { setResult({ success: false, message: "Ingresá al menos un email destinatario" }); return; }
    if (!subject.trim()) { setResult({ success: false, message: "El asunto no puede estar vacío" }); return; }

    // Parse multiple emails (comma or semicolon separated)
    const emails = to.split(/[,;]\s*/).map(e => e.trim()).filter(Boolean);
    if (emails.length === 0) { setResult({ success: false, message: "Ingresá al menos un email válido" }); return; }

    setSending(true);
    setResult(null);

    try {
      // 1. Generate PDF client-side
      let pdfBase64: string;
      try {
        pdfBase64 = await generatePdf();
      } catch (pdfErr: any) {
        setResult({ success: false, message: `Error al generar PDF: ${pdfErr.message || "desconocido"}` });
        setSending(false);
        return;
      }

      if (!pdfBase64) {
        setResult({ success: false, message: "No se pudo generar el PDF. No se envía el email." });
        setSending(false);
        return;
      }

      // 2. Send to API with PDF attached
      const res = await fetch("/api/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: emails,
          subject,
          bodyHtml: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;line-height:1.6">${bodyHtml.replace(/\n/g, "<br/>")}</div>`,
          pdfBase64,
          pdfFilename: pdfFilename || `${DOC_LABELS[documentType]}.pdf`,
          sociedadId,
          documentType,
          documentId,
          userEmail,
          ...(extraAttachments.length > 0 ? { extraAttachments } : {}),
        }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        setResult({ success: false, message: data.error || "Error al enviar" });
      } else {
        await onSuccess?.(data.emailId, emails);
        setResult({ success: true, message: `Email enviado correctamente a ${emails.join(", ")}${data.avisoRegistro ? `. ${data.avisoRegistro}` : ""}` });
      }
    } catch (err: any) {
      setResult({ success: false, message: err.message || "Error de conexión" });
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40" onClick={pedirCierre} />
      <div className={`fixed z-50 overflow-y-auto rounded-2xl bg-white p-4 shadow-2xl dark:bg-zinc-900 transition-all ${fullscreen ? "inset-2 max-h-[calc(100vh-1rem)]" : "inset-4 m-auto h-fit max-h-[85vh] w-full max-w-lg"}`}>
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Send className="h-5 w-5 text-orange-500" />
            <h2 className="text-lg font-bold dark:text-white">Enviar {DOC_LABELS[documentType]}</h2>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setFullscreen(f => !f)} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800" title={fullscreen ? "Reducir" : "Maximizar"}>{fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}</button>
            <button onClick={pedirCierre} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Result message */}
        {result && (
          <div className={`mb-4 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${
            result.success
              ? "bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-300"
              : "bg-red-50 border-red-200 text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-300"
          }`}>
            {result.success ? <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> : <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />}
            <span>{result.message}</span>
          </div>
        )}

        {/* Form */}
        <div className="space-y-3">
          {aviso && <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">{aviso}</div>}
          {/* To */}
          <div>
            <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Para *</label>
            <input
              type="text"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="email@ejemplo.com (separar con comas)"
              className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            />
            {suggestedEmails.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {suggestedEmails.filter((s, i) => verTodos || i < SUGERIDOS_VISIBLES || to.toLowerCase().includes(s.email.toLowerCase())).map((s, i) => {
                  const currentEmails = to.split(/[,;]\s*/).map(e => e.trim()).filter(Boolean);
                  const isAdded = currentEmails.includes(s.email);
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        if (isAdded) {
                          setTo(currentEmails.filter(e => e !== s.email).join(", "));
                        } else {
                          setTo(to.trim() ? `${to.trim()}, ${s.email}` : s.email);
                        }
                      }}
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                        isAdded
                          ? "bg-orange-100 text-orange-700 border border-orange-300 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-700"
                          : "bg-zinc-100 text-zinc-600 border border-zinc-200 hover:bg-orange-50 hover:text-orange-600 hover:border-orange-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700 dark:hover:bg-orange-950/30"
                      }`}
                      title={isAdded ? "Click para quitar" : "Click para agregar"}
                    >
                      {isAdded && <CheckCircle2 className="h-3 w-3" />}
                      {s.label ? `${s.label} (${s.email})` : s.email}
                    </button>
                  );
                })}
                {suggestedEmails.length > SUGERIDOS_VISIBLES && (
                  <button type="button" onClick={() => setVerTodos(v => !v)} className="rounded-full px-2.5 py-1 text-xs font-medium text-orange-600 hover:underline">
                    {verTodos ? "Ver menos" : `Ver todos (${suggestedEmails.length})`}
                  </button>
                )}
              </div>
            )}
            {nuevos.map(e => (
              <button key={e} type="button" onClick={() => guardarEste(e)} disabled={guardando === e}
                className="mt-1.5 mr-1.5 inline-flex items-center gap-1 rounded-lg border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                title="Lo agrega a los contactos para la próxima vez">
                {guardando === e ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserPlus className="h-3 w-3" />} Guardar este contacto ({e})
              </button>
            ))}
          </div>

          {/* Subject */}
          <div>
            <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Asunto *</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            />
          </div>

          {/* Body */}
          <div>
            <button type="button" onClick={() => setVerMensaje(v => !v)} className="text-xs font-medium text-zinc-500 hover:text-orange-600 dark:text-zinc-400">
              Mensaje {verMensaje ? "▾" : "▸"} <span className="font-normal text-zinc-400">{verMensaje ? "" : "(tocá para ver o cambiar)"}</span>
            </button>
            {verMensaje && (
              <textarea
                value={bodyHtml}
                onChange={(e) => setBodyHtml(e.target.value)}
                rows={5}
                className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white resize-y"
              />
            )}
          </div>

          {/* Attachments */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 rounded-lg bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800 px-3 py-2.5">
              <Paperclip className="h-4 w-4 text-orange-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-orange-700 dark:text-orange-300 truncate">
                  {pdfFilename || `${DOC_LABELS[documentType]}.pdf`}
                </p>
                <p className="text-xs text-orange-500">Se genera y adjunta automaticamente al enviar</p>
              </div>
            </div>
            {extraAttachments.map((att, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 px-3 py-2">
                <Paperclip className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                <p className="text-sm text-zinc-600 dark:text-zinc-300 truncate flex-1">{att.filename}</p>
              </div>
            ))}
          </div>

          {/* Send button */}
          <div className="sticky bottom-0 -mx-4 -mb-4 flex gap-2 border-t border-zinc-200 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-900">
            <button
              onClick={handleSend}
              disabled={sending || (result?.success === true)}
              className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {sending ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Generando PDF y enviando...</>
              ) : result?.success ? (
                <><CheckCircle2 className="h-4 w-4" /> Enviado</>
              ) : (
                <><Send className="h-4 w-4" /> Enviar email</>
              )}
            </button>
            {onMarkSent && !result?.success && (
              <button
                onClick={async () => {
                  await onMarkSent();
                  setResult({ success: true, message: "Marcada como enviada" });
                }}
                disabled={sending}
                className="flex items-center justify-center gap-2 rounded-lg border border-emerald-300 dark:border-emerald-700 px-3 py-2.5 text-sm font-medium text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 disabled:opacity-50 transition-colors"
                title="Marcar como enviada sin enviar email (ej: ya la mandaste por WhatsApp)"
              >
                <CheckCheck className="h-4 w-4" /> Enviada por fuera
              </button>
            )}
            <button
              onClick={onClose}
              className="flex items-center justify-center gap-2 rounded-lg border border-zinc-300 dark:border-zinc-600 px-4 py-2.5 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
            >
              {result?.success ? "Cerrar" : "Cancelar"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
