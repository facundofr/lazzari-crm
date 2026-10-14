"use client";

/**
 * La carga masiva de facturas de compra vive en el armazón del CRM (no en una pantalla):
 * se abre desde Compras o Finanzas, se puede minimizar y sigue leyendo/cruzando aunque cambies de pantalla.
 * Cada vez que se guarda una factura avisa con el evento "lz:facturas-compra" para que las pantallas se actualicen.
 */
import { createContext, useCallback, useContext, useState } from "react";
import { useUser } from "@/lib/auth-context";
import CargaMasivaFacturasCompra from "@/components/carga-masiva-facturas-compra";

export const EVENTO_FACTURAS_COMPRA = "lz:facturas-compra";

const Ctx = createContext<{ abrirCargaMasiva: () => void; activa: boolean }>({ abrirCargaMasiva: () => {}, activa: false });
export const useCargaMasiva = () => useContext(Ctx);

export function CargaMasivaProvider({ children }: { children: React.ReactNode }) {
  const { sociedadActiva, profile } = useUser();
  // La sociedad se fija al abrir: si cambiás de sociedad con la carga en segundo plano, sigue guardando en la original.
  const [sesion, setSesion] = useState<{ sociedadId: string; sociedadNombre: string; clave: number } | null>(null);
  const [oculta, setOculta] = useState(false);

  const abrirCargaMasiva = useCallback(() => {
    setOculta(false);
    setSesion((s) => s || (sociedadActiva?.id ? { sociedadId: sociedadActiva.id, sociedadNombre: sociedadActiva.nombre, clave: Date.now() } : null));
  }, [sociedadActiva?.id, sociedadActiva?.nombre]);

  const avisar = () => window.dispatchEvent(new Event(EVENTO_FACTURAS_COMPRA));

  return (
    <Ctx.Provider value={{ abrirCargaMasiva, activa: !!sesion }}>
      {children}
      {sesion && (
        <CargaMasivaFacturasCompra
          key={sesion.clave}
          sociedadId={sesion.sociedadId}
          sociedadNombre={sesion.sociedadNombre}
          profileId={profile?.id || null}
          oculta={oculta}
          onMinimizar={() => setOculta(true)}
          onAbrir={() => setOculta(false)}
          onGuardada={avisar}
          onClose={() => { setSesion(null); setOculta(false); }}
          onSuccess={() => { setSesion(null); setOculta(false); avisar(); }}
        />
      )}
    </Ctx.Provider>
  );
}
