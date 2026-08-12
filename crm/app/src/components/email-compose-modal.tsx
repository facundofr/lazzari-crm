"use client";

import { useState } from "react";
import { X, Send, Loader2, Paperclip, AlertTriangle, CheckCircle2 } from "lucide-react";

export type EmailDocumentType = "presupuesto" | "factura" | "remito" | "orden_compra" | "orden_pago";

interface EmailComposeModalProps {
  open: boolean;
  onClose: () => void;
  documentType: EmailDocumentType;
  documentId: string;
  sociedadId: string;
  /** Pre-filled recipient email(s) */
  defaultTo?: string;
  /** Pre-filled subject */
  defaultSubject?: string;
  /** Pre-filled body HTML */
  defaultBody?: string;
  /** PDF filename hint for display */
  pdfFilename?: string;
  /** Callback on successful send */
  onSuccess?: () => void;
}

const DOC_LABELS: Record<EmailDocumentType, string> = {
  presupuesto: "Presupuesto",
  factura: "Factura",
  remito: "Remito",
  orden_compra: "Orden de Compra",
  orden_pago: "Orden de Pago",
};

export function EmailComposeModal({
  open,
  onClose,
  documentType,
  documentId,
  sociedadId,
  defaultTo = "",
  defaultSubject = "",
  defaultBody = "",
  pdfFilename = "",
  onSuccess,
}: EmailComposeModalProps) {
  const [to, setTo] = useState(defaultTo);
  const [subject, setSubject] = useState(defaultSubject);
  const [bodyHtml, setBodyHtml] = useState(defaultBody);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  // Reset state when modal opens with new defaults
  useState(() => {
    setTo(defaultTo);
    setSubject(defaultSubject);
    setBodyHtml(defaultBody);
    setResult(null);
  });

  if (!open) return null;

  async function handleSend() {
    if (!to.trim()) { setResult({ success: false, message: "Ingresá al menos un email destinatario" }); return; }
    if (!subject.trim()) { setResult({ success: false, message: "El asunto no puede estar vacío" }); return; }

    // Parse multiple emails (comma or semicolon separated)
    const emails = to.split(/[,;]\s*/).map(e => e.trim()).filter(Boolean);
    if (emails.length === 0) { setResult({ success: false, message: "Ingresá al menos un email válido" }); return; }

    setSending(true);
    setResult(null);

    try {
      const res = await fetch("/api/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: emails,
          subject,
          bodyHtml: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;line-height:1.6">${bodyHtml.replace(/\n/g, "<br/>")}</div>`,
          documentType,
          documentId,
          sociedadId,
        }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        setResult({ success: false, message: data.error || "Error al enviar" });
      } else {
        setResult({ success: true, message: `Email enviado correctamente a ${emails.join(", ")}` });
        onSuccess?.();
      }
    } catch (err: any) {
      setResult({ success: false, message: err.message || "Error de conexión" });
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose} />
      <div className="fixed inset-4 z-50 m-auto h-fit max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-zinc-900">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Send className="h-5 w-5 text-orange-500" />
            <h2 className="text-lg font-bold dark:text-white">Enviar {DOC_LABELS[documentType]}</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <X className="h-4 w-4" />
          </button>
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
        <div className="space-y-4">
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
            <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Mensaje</label>
            <textarea
              value={bodyHtml}
              onChange={(e) => setBodyHtml(e.target.value)}
              rows={6}
              className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white resize-y"
            />
          </div>

          {/* PDF attachment indicator */}
          <div className="flex items-center gap-2 rounded-lg bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800 px-3 py-2.5">
            <Paperclip className="h-4 w-4 text-orange-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-orange-700 dark:text-orange-300 truncate">
                {pdfFilename || `${DOC_LABELS[documentType]}.pdf`}
              </p>
              <p className="text-xs text-orange-500">Se genera y adjunta automáticamente al enviar</p>
            </div>
          </div>

          {/* Send button */}
          <div className="flex gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-700">
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
