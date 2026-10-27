"use client";

// Saldo de cada cliente (pesos y dólares) para el aviso «Límite de crédito alcanzado» al facturar desde Finanzas
// (auditoría UX 27/10/2026, arreglo 12: desde Ventas y Facturación aparecía; desde Finanzas no, porque no se le pasaba el saldo).
// Se trae recién cuando se abre la ventana de factura (`activo`), así el inicio de Finanzas no carga de más. Si falla, el aviso no sale: nunca frena.
import { useEffect, useState } from "react";
import type { SaldoCliente } from "@/lib/saldo-clientes";
import { todayAR } from "@/lib/utils";
import { traerDeudas } from "./datos";

export function useSaldosClientes(sociedadId: string, activo: boolean): Record<string, SaldoCliente> | null {
  const [saldos, setSaldos] = useState<Record<string, SaldoCliente> | null>(null);
  useEffect(() => {
    if (!activo) return;
    let vivo = true;
    traerDeudas(sociedadId, todayAR())
      .then((d) => { if (vivo) setSaldos(d.saldosClientes as Record<string, SaldoCliente>); })
      .catch((e) => console.error("Finanzas Lazza · saldo de clientes para el aviso de crédito:", e));
    return () => { vivo = false; };
  }, [sociedadId, activo]);
  return saldos;
}
