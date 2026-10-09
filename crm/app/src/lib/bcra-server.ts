import * as https from "node:https";
import { empeoro, filaInforme, mesActual, resumirBCRA, resumenConError, type ResumenBCRA } from "@/lib/bcra";

/**
 * Consulta la Central de Deudores del BCRA desde el servidor (los navegadores no pueden por CORS).
 * El servidor del BCRA a veces publica la cadena de certificados incompleta: si Node no la puede
 * validar, se reintenta SOLO contra api.bcra.gob.ar sin validar la cadena (datos públicos, solo lectura).
 */
const BASE = "https://api.bcra.gob.ar/CentralDeDeudores/v1.0/Deudas";

type Respuesta = { status: number; body: any };

function getInseguro(url: string, timeoutMs: number): Promise<Respuesta> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { rejectUnauthorized: false, headers: { Accept: "application/json" }, timeout: timeoutMs }, res => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", c => { raw += c; });
      res.on("end", () => {
        let body: any = null;
        try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
        resolve({ status: res.statusCode || 0, body });
      });
    });
    req.on("timeout", () => req.destroy(new Error("Tiempo de espera agotado")));
    req.on("error", reject);
  });
}

function esErrorCertificado(e: any): boolean {
  const code = String(e?.cause?.code || e?.code || "");
  return /CERT|SIGNATURE|SELF_SIGNED|UNABLE_TO_GET_ISSUER/i.test(code);
}

async function get(url: string, timeoutMs = 12_000): Promise<Respuesta> {
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    let body: any = null;
    try { body = await res.json(); } catch { body = null; }
    return { status: res.status, body };
  } catch (e: any) {
    if (esErrorCertificado(e)) return getInseguro(url, timeoutMs);
    throw e;
  }
}

/** Devuelve el cuerpo (200), null (404 = sin datos) o tira error. */
async function endpoint(path: string): Promise<any | null> {
  const r = await get(`${BASE}${path}`);
  if (r.status === 200) return r.body;
  if (r.status === 404) return null;
  const msg = Array.isArray(r.body?.errorMessages) ? r.body.errorMessages.join(" ") : `BCRA respondió ${r.status}`;
  throw new Error(msg);
}

export async function consultarBCRA(cuit: string): Promise<ResumenBCRA> {
  try {
    const [deudas, historicas, cheques] = await Promise.all([
      endpoint(`/${cuit}`),
      endpoint(`/Historicas/${cuit}`).catch(() => null), // el histórico es opcional
      endpoint(`/ChequesRechazados/${cuit}`),
    ]);
    return resumirBCRA(cuit, deudas, historicas, cheques);
  } catch (e: any) {
    return resumenConError(cuit, e?.message || "No se pudo consultar al BCRA");
  }
}

/**
 * Consulta, guarda el informe del mes (uno por cliente y mes) y, si empeoró respecto del
 * informe anterior, deja un aviso en la campanita. Sirve con la sesión del usuario (respeta permisos)
 * o con la clave de servicio (cron mensual).
 */
export async function actualizarInformeCliente(
  db: any,
  c: { sociedad_id: string; cliente_id: string; cuit: string; razon_social?: string | null },
): Promise<ResumenBCRA & { empeoro: string | null }> {
  const r = await consultarBCRA(c.cuit);
  const mes = mesActual();
  const { data: previos } = await db.from("cliente_bcra_informes")
    .select("mes, semaforo, peor_situacion, cheques_sin_pagar")
    .eq("cliente_id", c.cliente_id).neq("semaforo", "gris").neq("mes", mes)
    .order("mes", { ascending: false }).limit(1);
  const motivo = empeoro(previos?.[0] || null, r);

  // Si la consulta falló y ya había un informe bueno este mes, no lo pisa con el error.
  if (r.semaforo === "gris") {
    const { data: actual } = await db.from("cliente_bcra_informes").select("id, semaforo").eq("cliente_id", c.cliente_id).eq("mes", mes).maybeSingle();
    if (actual && actual.semaforo !== "gris") return { ...r, empeoro: null };
  }
  const { error } = await db.from("cliente_bcra_informes").upsert(filaInforme(r, c.sociedad_id, c.cliente_id, mes), { onConflict: "cliente_id,mes" });
  if (error) throw new Error(error.message);

  if (motivo) {
    await db.from("alertas").insert({
      tipo: "seguimiento",
      title: `BCRA: ${c.razon_social || r.denominacion || c.cuit}`,
      description: `En la Central de Deudores ${motivo}. Revisá la ficha del cliente antes de darle más cuenta corriente.`,
      module: "clientes",
      entity_type: "cliente",
      entity_id: c.cliente_id,
      user_id: null,
      sociedad_id: c.sociedad_id,
    });
  }
  return { ...r, empeoro: motivo };
}
