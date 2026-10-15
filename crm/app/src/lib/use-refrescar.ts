"use client";

import { useEffect, useRef } from "react";

/**
 * Vuelve a traer los datos cuando la persona vuelve a la pestaña o a la ventana (si pasaron más de `minSegundos`).
 * Evita ver estados viejos (ej. un PR que ya se facturó desde otra pantalla) en una pantalla que quedó abierta.
 * Refresca en silencio: no muestra "cargando" ni toca lo que se está escribiendo.
 */
export function useRefrescarAlVolver(refrescar: () => void | Promise<unknown>, minSegundos = 45) {
  const ultima = useRef(refrescar);
  useEffect(() => { ultima.current = refrescar; });
  const ultimoRefresco = useRef(Date.now());
  useEffect(() => {
    const volver = () => {
      if (document.visibilityState === "hidden") return;
      if (Date.now() - ultimoRefresco.current < minSegundos * 1000) return;
      ultimoRefresco.current = Date.now();
      void ultima.current();
    };
    document.addEventListener("visibilitychange", volver);
    window.addEventListener("focus", volver);
    return () => { document.removeEventListener("visibilitychange", volver); window.removeEventListener("focus", volver); };
  }, [minSegundos]);
}
