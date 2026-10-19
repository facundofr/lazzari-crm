"use client";

// Zona para soltar archivos (arrastrar desde la compu o desde WhatsApp Web) y pegar capturas con Ctrl+V.
// Se usa en las ventanas de cobro para que la IA lea la OP, la transferencia, el cheque o la retención.
import { useEffect, useState, type ReactNode } from "react";

const TIPOS_OK = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
export const archivosValidos = (files: File[]) => files.filter((f) => TIPOS_OK.includes(f.type) || /\.(pdf|png|jpe?g|webp)$/i.test(f.name));

export function ZonaArchivos({ onArchivos, disabled = false, pegar = true, children, className = "" }: {
  onArchivos: (files: File[]) => void;
  disabled?: boolean;
  /** Ctrl+V con una captura o un PDF copiado (mientras la ventana está abierta). */
  pegar?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const [encima, setEncima] = useState(false);

  useEffect(() => {
    if (!pegar || disabled) return;
    const alPegar = (e: ClipboardEvent) => {
      // Si se está escribiendo en un campo y se pega texto, no se toca.
      const files = archivosValidos(Array.from(e.clipboardData?.files || []));
      if (!files.length) return;
      e.preventDefault();
      onArchivos(files);
    };
    window.addEventListener("paste", alPegar);
    return () => window.removeEventListener("paste", alPegar);
  }, [pegar, disabled, onArchivos]);

  return (
    <div
      onDragOver={(e) => { if (disabled) return; e.preventDefault(); setEncima(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setEncima(false); }}
      onDrop={(e) => {
        e.preventDefault(); setEncima(false);
        if (disabled) return;
        const files = archivosValidos(Array.from(e.dataTransfer.files || []));
        if (files.length) onArchivos(files);
      }}
      className={`rounded-lg border-2 border-dashed transition-colors ${encima ? "border-orange-500 bg-orange-50 dark:bg-orange-950/30" : "border-orange-200 dark:border-orange-900/60"} ${className}`}
    >
      {children}
    </div>
  );
}
