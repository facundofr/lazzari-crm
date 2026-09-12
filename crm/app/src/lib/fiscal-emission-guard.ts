import { createHash } from "node:crypto";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
    return "{" + entries.map(([key, val]) => `${JSON.stringify(key)}:${canonical(val)}`).join(",") + "}";
  }
  return JSON.stringify(value) ?? "null";
}

export function fiscalPayloadHash(body: unknown): string {
  return createHash("sha256").update(canonical(body)).digest("hex");
}

export function validEmissionKey(key: string | null): key is string {
  return !!key && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key);
}

export async function reserveFiscalEmission(db: any, sociedadId: string, key: string, hash: string, puntoVenta: number, payload: unknown) {
  const { data, error } = await db.rpc("reservar_emision_fiscal", {
    p_sociedad_id: sociedadId, p_request_key: key, p_payload_hash: hash, p_punto_venta: puntoVenta,
    p_payload: payload,
  });
  if (error || !data || typeof data.acquired !== "boolean") {
    throw new Error("No se pudo registrar de forma segura el intento de emisión. No se envió a ARCA.");
  }
  return data as { acquired: boolean; state: string; status: number | null; response: Record<string, unknown> | null };
}

export async function finishFiscalEmission(db: any, sociedadId: string, key: string, hash: string, state: "authorized" | "completed", status: number, response: Record<string, unknown>) {
  const { error } = await db.rpc("finalizar_emision_fiscal", {
    p_sociedad_id: sociedadId, p_request_key: key, p_payload_hash: hash,
    p_state: state, p_status: status, p_response: response,
  });
  if (error) throw new Error("El intento quedó protegido pero no se pudo guardar su resultado. No vuelvas a emitir: requiere conciliación con ARCA.");
}
