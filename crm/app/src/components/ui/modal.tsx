"use client";

import { useEffect, useCallback, useState } from "react";
import { X, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "2xl";
  allowFullscreen?: boolean;
  /** Si viene, Escape, el clic afuera y la X preguntan esto antes de cerrar (ej. hay cambios sin guardar). */
  confirmarCierre?: string;
}

const sizeClasses = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
  "2xl": "max-w-7xl",
};

// Todos los modales pueden ampliarse: algunos formularios (contactos, facturas,
// configuraciones) necesitan más espacio y antes quedaban encerrados en una
// ventana pequeña sin alternativa para el usuario.
export function Modal({ open, onClose, title, description, children, footer, size = "md", allowFullscreen = true, confirmarCierre }: ModalProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const pedirCierre = useCallback(() => {
    if (confirmarCierre && !window.confirm(confirmarCierre)) return;
    onClose();
  }, [onClose, confirmarCierre]);
  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") pedirCierre();
  }, [pedirCierre]);

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [open, handleEscape]);

  useEffect(() => {
    if (!open) setIsFullscreen(false);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 animate-fade-in" onClick={pedirCierre} />

      {/* Dialog */}
      <div className={cn(
        "relative w-full rounded-2xl bg-white shadow-2xl dark:bg-zinc-900 animate-scale-in transition-all duration-200",
        isFullscreen ? "mx-4 my-4 max-w-none h-[calc(100vh-2rem)]" : cn("mx-4", sizeClasses[size])
      )}>
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-3 border-b border-zinc-200 dark:border-zinc-700">
          <div>
            <h2 className="text-base font-bold text-zinc-900 dark:text-white">{title}</h2>
            {description && <p className="mt-0.5 text-xs text-zinc-500">{description}</p>}
          </div>
          <div className="flex items-center gap-1">
            {allowFullscreen && (
              <button
                onClick={() => setIsFullscreen(!isFullscreen)}
                className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 transition-colors dark:hover:bg-zinc-800"
                title={isFullscreen ? "Reducir" : "Pantalla completa"}
              >
                <Maximize2 className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={pedirCierre}
              className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 transition-colors dark:hover:bg-zinc-800"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className={cn("overflow-y-auto px-5 py-4", isFullscreen ? "h-[calc(100%-6.5rem)]" : "max-h-[75vh]")}>
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="flex justify-end gap-2 px-5 py-2.5 border-t border-zinc-200 dark:border-zinc-700">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
