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
  return actualizarInforme(db, "cliente", c.cliente_id, c);
}

/** Igual que el de clientes, para proveedores (tabla proveedor_bcra_informes). Solo avisa. */
export async function actualizarInformeProveedor(
  db: any,
  c: { sociedad_id: string; proveedor_id: string; cuit: string; razon_social?: string | null },
): Promise<ResumenBCRA & { empeoro: string | null }> {
  return actualizarInforme(db, "proveedor", c.proveedor_id, c);
}

async function actualizarInforme(
  db: any,
  tipo: "cliente" | "proveedor",
  entidadId: string,
  c: { sociedad_id: string; cuit: string; razon_social?: string | null },
): Promise<ResumenBCRA & { empeoro: string | null }> {
  const tabla = `${tipo}_bcra_informes`;
  const col = `${tipo}_id`;
  const r = await consultarBCRA(c.cuit);
  const mes = mesActual();
  const { data: previos } = await db.from(tabla)
    .select("mes, semaforo, peor_situacion, cheques_sin_pagar")
    .eq(col, entidadId).neq("semaforo", "gris").neq("mes", mes)
    .order("mes", { ascending: false }).limit(1);
  const motivo = empeoro(previos?.[0] || null, r);

  // Si la consulta falló y ya había un informe bueno este mes, no lo pisa con el error.
  if (r.semaforo === "gris") {
    const { data: actual } = await db.from(tabla).select("id, semaforo").eq(col, entidadId).eq("mes", mes).maybeSingle();
    if (actual && actual.semaforo !== "gris") return { ...r, empeoro: null };
  }
  const { cliente_id: _omitido, ...fila } = filaInforme(r, c.sociedad_id, entidadId, mes);
  const { error } = await db.from(tabla).upsert({ ...fila, [col]: entidadId }, { onConflict: `${col},mes` });
  if (error) throw new Error(error.message);

  if (motivo) {
    await db.from("alertas").insert({
      tipo: "seguimiento",
      title: `BCRA: ${c.razon_social || r.denominacion || c.cuit}`,
      description: tipo === "cliente"
        ? `En la Central de Deudores ${motivo}. Revisá la ficha del cliente antes de darle más cuenta corriente.`
        : `En la Central de Deudores ${motivo}. Es solo un aviso: revisá la ficha del proveedor antes de comprarle o pagarle por adelantado.`,
      module: tipo === "cliente" ? "clientes" : "proveedores",
      entity_type: tipo,
      entity_id: entidadId,
      user_id: null,
      sociedad_id: c.sociedad_id,
    });
  }
  return { ...r, empeoro: motivo };
}
