// Facturas de compra pagadas con tarjeta: el pago queda registrado en la cuenta de la tarjeta.
// Así el saldo con el proveedor da 0, la tarjeta suma su deuda y después se cruza con el resumen.
// Regla de Augusto: lo de Mercado Libre se paga con la Visa (tarjeta sugerida para todo lo nuevo).

export interface Tarjeta { id: string; nombre: string }

/** Tarjeta sugerida (nunca obligatoria): compra en Mercado Libre u OC marcada "pagada con tarjeta" → Visa (o la primera). */
export function tarjetaSugerida(tarjetas: Tarjeta[], o: { proveedorNombre?: string | null; ocConTarjeta?: boolean }): Tarjeta | null {
  if (!tarjetas.length) return null;
  const esML = /mercado\s*libre/i.test(String(o.proveedorNombre || ""));
  if (!esML && !o.ocConTarjeta) return null;
  return tarjetas.find((t) => /visa/i.test(t.nombre)) || tarjetas[0];
}

/** Movimiento de pago con tarjeta para una factura de compra ya guardada. */
export function movimientoPagoTarjeta(p: {
  sociedadId: string; proveedorId: string; facturaId: string; tarjeta: Tarjeta;
  total: number; moneda: string; fecha: string; comprobante: string; proveedorNombre?: string; userId?: string | null;
}) {
  return {
    tipo: "pago", sociedad_id: p.sociedadId, proveedor_id: p.proveedorId, factura_compra_id: p.facturaId,
    cuenta_id: p.tarjeta.id, monto: Math.round(Number(p.total || 0) * 100) / 100, moneda: p.moneda === "USD" ? "USD" : "ARS", fecha: p.fecha,
    descripcion: `Pago con ${p.tarjeta.nombre} — ${p.comprobante}${p.proveedorNombre ? ` — ${p.proveedorNombre}` : ""}`.slice(0, 250),
    created_by: p.userId ?? null,
  };
}

const faltaFuncion = (e: any) => e && (e.code === "PGRST202" || e.code === "42883" || /function .* does not exist|Could not find the function/i.test(String(e.message || "")));

/** Tarjetas activas de la sociedad. Usa la función de la base (la ven también los compradores); si no está, lee la tabla. */
export async function traerTarjetas(db: any, sociedadId: string): Promise<Tarjeta[]> {
  const { data, error } = await db.rpc("tarjetas_de_sociedad", { p_sociedad_id: sociedadId });
  if (!error) return (data || []).map((t: any) => ({ id: t.id, nombre: t.nombre }));
  if (!faltaFuncion(error)) throw error;
  const { data: filas } = await db.from("cuentas_financieras").select("id, nombre, activa, orden")
    .eq("sociedad_id", sociedadId).eq("tipo", "tarjeta_credito").order("orden");
  return (filas || []).filter((t: any) => t.activa !== false).map((t: any) => ({ id: t.id, nombre: t.nombre }));
}

/**
 * Registra el pago con tarjeta de una factura ya guardada y la deja "pagada".
 * La función de la base controla sociedad, tarjeta y que no se duplique; si todavía no está, inserta el movimiento directo.
 */
export async function registrarPagoTarjeta(db: any, facturaId: string, tarjeta: Tarjeta, respaldo: ReturnType<typeof movimientoPagoTarjeta>): Promise<{ error?: string }> {
  const { error } = await db.rpc("registrar_pago_tarjeta_factura_compra", { p_factura_id: facturaId, p_cuenta_id: tarjeta.id });
  if (!error) return {};
  if (!faltaFuncion(error)) return { error: error.message };
  const { error: eEstado } = await db.from("facturas_compra").update({ estado: "pagada" }).eq("id", facturaId);
  if (eEstado) return { error: eEstado.message };
  const { error: eMov } = await db.from("movimientos").insert(respaldo);
  return eMov ? { error: eMov.message } : {};
}
