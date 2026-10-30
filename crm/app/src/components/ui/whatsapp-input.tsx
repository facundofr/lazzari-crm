"use client";

// WhatsApp en dos casillas: característica (sin 0) y número (sin 15). Devuelve "2477 688498" (ver lib/whatsapp-ar.ts).
// Si el número no suma 10 dígitos, avisa abajo en amarillo; nunca frena.
// Augusto 30/10/2026: es la carga de teléfonos de todo el CRM (proveedores, clientes, contactos, sucursales, transportistas).
import { useEffect, useRef, useState } from "react";
import { separarWhatsApp, unirWhatsApp, avisoWhatsApp } from "@/lib/whatsapp-ar";

/** `label`: rótulo arriba, igual que el de ui/input (Teléfono, WhatsApp). */
export function WhatsAppInput({ value, onChange, className = "", label }: { value: string; onChange: (v: string) => void; className?: string; label?: string }) {
  const [partes, setPartes] = useState(() => separarWhatsApp(value));
  const ultimo = useRef(value);
  useEffect(() => {
    // Solo se vuelve a separar si el valor cambió desde afuera (otro proveedor, otro contacto).
    if (value !== ultimo.current) { ultimo.current = value; setPartes(separarWhatsApp(value)); }
  }, [value]);

  const cambiar = (area: string, numero: string) => {
    setPartes({ area, numero });
    const v = unirWhatsApp(area, numero);
    ultimo.current = v;
    onChange(v);
  };
  const aviso = avisoWhatsApp(partes.area, partes.numero);
  const caja = "h-9 rounded-lg border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white";

  return (
    <div className={`${label ? "space-y-1.5 " : ""}${className}`}>
      {label && <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">{label}</label>}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-zinc-400">+54 9</span>
        <input value={partes.area} onChange={(e) => cambiar(e.target.value, partes.numero)} inputMode="numeric" placeholder="Caract." aria-label="Característica"
          title="Característica sin el 0 (ej. 11, 341, 2477)" className={`${caja} w-20`} />
        <input value={partes.numero} onChange={(e) => cambiar(partes.area, e.target.value)} inputMode="numeric" placeholder="Número sin 15" aria-label="Número"
          className={`${caja} min-w-0 flex-1`} />
      </div>
      {aviso && <p className="mt-0.5 text-[11px] text-amber-600">{aviso}</p>}
    </div>
  );
}
