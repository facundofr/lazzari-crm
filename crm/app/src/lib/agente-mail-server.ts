// Agente de correo y cobros (SOLO servidor). Lee la casilla administracion@ con la API de Gmail (solo lectura),
// clasifica cada mail con IA barata, lee adjuntos (texto primero, visión si hace falta) y cruza avisos de pago con facturas abiertas.
// Solo SUGIERE: no responde mails, no registra cobros, no toca facturas ni movimientos. Escribe únicamente en sus 2 tablas y en notificaciones.
// Variables en Vercel: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, ANTHROPIC_API_KEY.
import Anthropic from "@anthropic-ai/sdk";
import {
  CATEGORIAS_MAIL, DESDE_INICIAL, MAX_MAILS_POR_CORRIDA, MAX_PDF_VISION_POR_CORRIDA, categoriaInfo, costoModeloUSD, cruzarPago,
  extraerJSON, inicioDiaAR, normalizarCategoria, superaTopeDiario, type EntradaBanco, type FacturaAbierta,
} from "@/lib/agente-mail";

const MODELO = "claude-haiku-4-5-20251001";
const EN_PARALELO = 3;
const PRESUPUESTO_MS = 30_000; // la ruta corta a los 60 s; un mail con PDF puede tardar 15 s
const MAX_ADJUNTO_BYTES = 4_500_000;
const SOCIEDAD_LAZZARI = "eee2a3c8-fe6c-494d-bd2f-7a5d8067d021";
const SOCIEDAD_GRUPO_LA = "fee94607-747a-4e87-ba24-aff9032f7a56";
const CUIT_SOCIEDAD: Record<string, string> = { "20379309128": SOCIEDAD_LAZZARI, "30719396042": SOCIEDAD_GRUPO_LA };

// ── Gmail (REST, solo lectura) ───────────────────────────────────────────────
type Adjunto = { nombre: string; mime: string; attachmentId: string; size: number };
type MensajeGmail = { id: string; threadId: string; fecha: string | null; remitente: string; asunto: string; texto: string; adjuntos: Adjunto[] };

async function tokenGmail(): Promise<string> {
  const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN } = process.env;
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) throw new Error("Faltan las variables GMAIL_* en Vercel");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: GMAIL_CLIENT_ID, client_secret: GMAIL_CLIENT_SECRET, refresh_token: GMAIL_REFRESH_TOKEN, grant_type: "refresh_token" }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`Gmail no dejó entrar (${j.error || r.status}): hay que repetir la autorización`);
  return j.access_token;
}

async function gmail(token: string, ruta: string): Promise<any> {
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${ruta}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Gmail ${r.status} en ${ruta.split("?")[0]}`);
  return r.json();
}

/** Ids de mails de la bandeja de entrada desde la fecha, del más nuevo al más viejo. */
async function listarIds(token: string, desde: string): Promise<string[]> {
  const ids: string[] = [];
  let pagina = "";
  for (let i = 0; i < 6; i++) {
    const q = encodeURIComponent(`in:inbox after:${desde}`);
    const j = await gmail(token, `messages?q=${q}&maxResults=100${pagina ? `&pageToken=${pagina}` : ""}`);
    for (const m of j.messages || []) ids.push(m.id);
    if (!j.nextPageToken) break;
    pagina = j.nextPageToken;
  }
  return ids;
}

const b64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
const sinHtml = (h: string) => h.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

async function leerMensaje(token: string, id: string): Promise<MensajeGmail> {
  const m = await gmail(token, `messages/${id}?format=full`);
  const h = (n: string) => (m.payload?.headers || []).find((x: any) => String(x.name).toLowerCase() === n)?.value || "";
  let plano = "", html = "";
  const adjuntos: Adjunto[] = [];
  const recorrer = (p: any) => {
    if (!p) return;
    if (p.filename && p.body?.attachmentId) adjuntos.push({ nombre: p.filename, mime: p.mimeType || "", attachmentId: p.body.attachmentId, size: p.body.size || 0 });
    else if (p.mimeType === "text/plain" && p.body?.data) plano += b64url(p.body.data).toString("utf8") + "\n";
    else if (p.mimeType === "text/html" && p.body?.data) html += b64url(p.body.data).toString("utf8") + "\n";
    for (const c of p.parts || []) recorrer(c);
  };
  recorrer(m.payload);
  return {
    id: m.id, threadId: m.threadId,
    fecha: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : null,
    remitente: h("from"), asunto: h("subject"),
    texto: (plano.trim() || sinHtml(html)).slice(0, 12000), adjuntos,
  };
}

async function bajarAdjunto(token: string, msgId: string, adj: Adjunto): Promise<Buffer> {
  const j = await gmail(token, `messages/${msgId}/attachments/${adj.attachmentId}`);
  return b64url(j.data || "");
}

// ── Texto de PDF sin IA ──────────────────────────────────────────────────────
async function textoDePdf(buf: Buffer): Promise<string> {
  try {
    const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, isEvalSupported: false }).promise;
    let out = "";
    for (let i = 1; i <= Math.min(doc.numPages, 8); i++) {
      const pag = await doc.getPage(i);
      const c = await pag.getTextContent();
      out += c.items.map((x: any) => x.str).join(" ") + "\n";
    }
    return out.replace(/[ \t]+/g, " ").trim();
  } catch {
    return "";
  }
}

// ── IA ───────────────────────────────────────────────────────────────────────
type Uso = { costo: number; entrada: number; salida: number };

async function pedirIA(client: Anthropic, system: string, content: any[], maxTokens: number, uso: Uso): Promise<any | null> {
  const r = await client.messages.create({ model: MODELO, max_tokens: maxTokens, system, messages: [{ role: "user", content }] });
  uso.entrada += r.usage?.input_tokens || 0;
  uso.salida += r.usage?.output_tokens || 0;
  uso.costo += costoModeloUSD(MODELO, r.usage?.input_tokens || 0, r.usage?.output_tokens || 0);
  const txt = r.content.map((b: any) => (b.type === "text" ? b.text : "")).join("");
  return extraerJSON(txt);
}

const LISTA_CATEGORIAS = CATEGORIAS_MAIL.map((c) => c.id).join(" | ");

const SISTEMA_CLASIFICAR = `Sos el asistente administrativo de Lazzari Soluciones Industriales (Argentina; ropa de trabajo, EPP y seguridad industrial). Leés los mails que llegan a administración y los clasificás. Todo lo que proponés es una sugerencia.
Devolvé SOLO un JSON: {"categoria": "${LISTA_CATEGORIAS}", "prioridad": "alta|normal|baja", "resumen": "máx 200 caracteres, en español", "accion_sugerida": "máx 120 caracteres, qué convendría hacer", "tiene_pago": true|false}
Categorías: pago_retencion = aviso de pago, orden de pago, transferencia, retenciones, comprobantes de pago de clientes; reclamo_consulta = reclamo o consulta de un proveedor o cliente (incluye reclamos de retención de IVA y consultas de pago); factura_proveedor = factura o nota de crédito de un proveedor; oc_cliente = orden de compra de un cliente; vencimiento_aviso = vencimientos o avisos administrativos (impuestos, bancos, servicios); otro = lo demás (publicidad, newsletters).`;

const SISTEMA_PROFUNDO = `Sos el asistente administrativo de Lazzari Soluciones Industriales (Argentina). Te paso un mail y sus adjuntos. Extraé los datos con mucho cuidado: los montos argentinos usan punto de miles y coma decimal ($1.234.567,89 = 1234567.89); devolvé números planos con punto decimal.
Devolvé SOLO un JSON: {"resumen": "máx 300 caracteres", "accion_sugerida": "máx 160 caracteres",
 "pago": null | {"direccion": "recibido" (un cliente nos pagó) | "emitido" (nosotros le pagamos a un proveedor), "cliente_nombre": str|null (quien PAGA), "cliente_cuit": str|null (CUIT de quien PAGA), "monto_neto": número|null (lo que se transfiere/deposita), "monto_total": número|null (suma de facturas pagadas antes de retenciones), "retenciones_total": número|null, "retenciones": [{"tipo": "iva|ganancias|iibb|suss|otra", "monto": número}], "fecha_pago": "YYYY-MM-DD"|null (las fechas argentinas son día/mes/año: 08/10/2026 es el 8 de octubre), "medio": str|null, "referencia": str|null, "facturas": [{"numero": "ej. 00016-00000018", "importe": número|null}]},
 "reclamo": null | {"de": str, "tema": str, "importe": número|null},
 "factura": null | {"emisor": str, "cuit": str|null, "numero": str|null, "importe": número|null, "vencimiento": "YYYY-MM-DD"|null, "es_nota_credito": bool}}
Los mails "Orden de Pago OP-0000xx — Lazzari Soluciones Industriales" son órdenes de pago NUESTRAS a un proveedor (direccion "emitido"), no cobros. Nuestra empresa es Lazzari (también figura como "Lazzari Augusto", "Lazzari Soluciones Industriales" o "Grupo LA"; CUIT 20-37930912-8 y 30-71939604-2): NUNCA es el cliente que paga, es quien cobra. El cliente es la empresa que emite la orden de pago o la transferencia. En "facturas" poné TODOS los comprobantes que el aviso dice que paga, con su número completo (punto de venta y número) y su importe. Completá solo lo que corresponda al mail; lo demás va null. Si un dato no está en el documento, null: no inventes.`;

// ── Datos del CRM para el cruce ──────────────────────────────────────────────
async function cargarFacturasAbiertas(db: any): Promise<(FacturaAbierta & { sociedad_id: string })[]> {
  const { data: fs } = await db.from("facturas")
    .select("id, tipo, punto_venta, numero, cliente_id, total, total_acreditado, moneda, tipo_cambio, sociedad_id, estado, clientes(razon_social, cuit)")
    .in("estado", ["emitida", "parcial", "vencida", "pagada"]).gte("fecha", "2026-01-01").limit(3000);
  const ids = (fs || []).map((f: any) => f.id);
  const aplicado = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data: ap } = await db.from("cobro_aplicaciones").select("factura_id, monto").in("factura_id", ids.slice(i, i + 200));
    for (const a of ap || []) aplicado.set(a.factura_id, (aplicado.get(a.factura_id) || 0) + Number(a.monto || 0));
  }
  return (fs || []).map((f: any) => ({
    id: f.id, tipo: f.tipo, punto_venta: f.punto_venta, numero: f.numero, cliente_id: f.cliente_id,
    cliente_nombre: f.clientes?.razon_social ?? null, cliente_cuit: f.clientes?.cuit ?? null,
    total: Number(f.total), moneda: f.moneda, tipo_cambio: f.tipo_cambio ? Number(f.tipo_cambio) : null, sociedad_id: f.sociedad_id, estado: f.estado,
    saldo: Math.max(0, Number(f.total) - (aplicado.get(f.id) || 0) - Number(f.total_acreditado || 0)),
  }));
}

async function cargarEntradasBanco(db: any): Promise<(EntradaBanco & { sociedad_id: string | null })[]> {
  const { data: cuentas } = await db.from("cuentas_financieras").select("id, sociedad_id");
  const soc = new Map<string, string>((cuentas || []).map((c: any) => [c.id, c.sociedad_id]));
  const { data: mv } = await db.from("extracto_movimientos").select("id, fecha, monto, descripcion, cuenta_id, estado")
    .in("estado", ["pendiente", "matcheado"]).eq("tipo", "credito").gte("fecha", "2026-09-15").limit(1000);
  return (mv || []).map((m: any) => ({ id: m.id, fecha: m.fecha, monto: Number(m.monto), descripcion: m.descripcion, estado: m.estado, sociedad_id: soc.get(m.cuenta_id) || null }));
}

function sociedadDelTexto(texto: string): string | null {
  const solo = texto.replace(/[-.\s]/g, "");
  for (const [cuit, id] of Object.entries(CUIT_SOCIEDAD)) if (solo.includes(cuit)) return id;
  return null;
}

// ── Corrida ──────────────────────────────────────────────────────────────────
export type ResultadoCorrida = { ok: boolean; nuevos: number; faltan: number; costo_usd: number; topeado: boolean; resumen: string; error?: string };

export async function correrAgenteMail(db: any, origen: "cron" | "manual"): Promise<ResultadoCorrida> {
  const inicio = Date.now();
  const { data: corrida } = await db.from("agente_mail_corridas").insert({ origen }).select("id").single();
  const total: Uso = { costo: 0, entrada: 0, salida: 0 };
  let nuevos = 0, faltan = 0, topeado = false, error: string | undefined;
  const porCategoria = new Map<string, number>();
  const urgentes: string[] = [];
  const porSociedad = new Map<string, number>();

  try {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("Falta ANTHROPIC_API_KEY");
    const token = await tokenGmail();
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const { data: hoy } = await db.from("agente_mail_procesados").select("costo_usd").gte("created_at", inicioDiaAR());
    let gastadoHoy = (hoy || []).reduce((a: number, r: any) => a + Number(r.costo_usd || 0), 0);

    const ids = await listarIds(token, DESDE_INICIAL);
    const yaVistos = new Set<string>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await db.from("agente_mail_procesados").select("gmail_message_id").in("gmail_message_id", ids.slice(i, i + 200));
      for (const r of data || []) yaVistos.add(r.gmail_message_id);
    }
    const pendientes = ids.filter((id) => !yaVistos.has(id));
    faltan = pendientes.length;

    const facturas = await cargarFacturasAbiertas(db);
    const entradas = await cargarEntradasBanco(db);
    const { data: ult } = await db.from("extracto_movimientos").select("fecha").order("fecha", { ascending: false }).limit(1);
    const extractoHasta: string | null = ult?.[0]?.fecha ? String(ult[0].fecha).slice(0, 10) : null;
    let visionUsada = 0;

    const procesarUno = async (id: string) => {
      const uso: Uso = { costo: 0, entrada: 0, salida: 0 }; // gasto de ESTE mail (se suma al total al final)
      const antes = 0;
      let fila: any;
      try {
        const msg = await leerMensaje(token, id);
        const cabecera = `De: ${msg.remitente}\nAsunto: ${msg.asunto}\nAdjuntos: ${msg.adjuntos.map((a) => a.nombre).join(", ") || "ninguno"}\n\n`;
        const clasif = (await pedirIA(client, SISTEMA_CLASIFICAR, [{ type: "text", text: cabecera + msg.texto.slice(0, 1500) }], 400, uso)) || {};
        const categoria = normalizarCategoria(clasif.categoria);
        const info = categoriaInfo(categoria);
        let resumen: string = String(clasif.resumen || "").slice(0, 400);
        let accion: string = String(clasif.accion_sugerida || "").slice(0, 300);
        let datos: any = null;
        const adjuntosInfo: { nombre: string; metodo: string }[] = [];

        const hayAdjuntos = msg.adjuntos.some((a) => /pdf|image\/(png|jpe?g)/i.test(a.mime));
        if (info.leerAdjuntos && (hayAdjuntos || categoria === "pago_retencion" || clasif.tiene_pago)) {
          const bloques: any[] = [];
          let textoAdj = "";
          // PDFs primero (lo importante); se ignoran logos y firmas ("image001.png", "noname", imágenes chicas).
          const ordenados = [...msg.adjuntos]
            .filter((a) => !(/^(image\d*|noname|logo.*)(\.(png|jpe?g|gif))?$/i.test(a.nombre.trim()) || (/image\//i.test(a.mime) && a.size < 40_000)))
            .sort((x, y) => Number(/pdf/i.test(y.mime) || /\.pdf$/i.test(y.nombre)) - Number(/pdf/i.test(x.mime) || /\.pdf$/i.test(x.nombre)))
            .slice(0, 4);
          for (const a of ordenados) {
            const esPdf = /pdf/i.test(a.mime) || /\.pdf$/i.test(a.nombre);
            const esImg = /image\/(png|jpe?g)/i.test(a.mime);
            if (!esPdf && !esImg) continue;
            if (a.size > MAX_ADJUNTO_BYTES) { adjuntosInfo.push({ nombre: a.nombre, metodo: "revisar_a_mano" }); continue; }
            const buf = await bajarAdjunto(token, msg.id, a);
            const t = esPdf ? await textoDePdf(buf) : "";
            if (t.length >= 300) {
              textoAdj += `\n--- ${a.nombre} ---\n${t.slice(0, 6000)}`;
              adjuntosInfo.push({ nombre: a.nombre, metodo: "texto" });
            } else if (visionUsada < MAX_PDF_VISION_POR_CORRIDA) {
              visionUsada++;
              bloques.push(esPdf
                ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") } }
                : { type: "image", source: { type: "base64", media_type: /png/i.test(a.mime) ? "image/png" : "image/jpeg", data: buf.toString("base64") } });
              adjuntosInfo.push({ nombre: a.nombre, metodo: "vision" });
            } else {
              adjuntosInfo.push({ nombre: a.nombre, metodo: "revisar_a_mano" });
            }
          }
          const prof = await pedirIA(client, SISTEMA_PROFUNDO,
            [...bloques, { type: "text", text: cabecera + msg.texto.slice(0, 4000) + textoAdj }], 1500, uso);
          if (prof) {
            resumen = String(prof.resumen || resumen).slice(0, 500);
            accion = String(prof.accion_sugerida || accion).slice(0, 300);
            datos = { pago: prof.pago || null, reclamo: prof.reclamo || null, factura: prof.factura || null };
          }
        }

        // Sociedad: por CUIT nombrado en el mail; si no, por las facturas que cruzan; si no, Lazzari.
        let sociedad = sociedadDelTexto(`${msg.asunto} ${msg.texto}`);
        if (datos?.pago) {
          const p = datos.pago;
          if (p.direccion === "emitido") {
            // Pago nuestro a un proveedor: no se cruza con facturas de venta.
            accion = `Pago nuestro${p.referencia ? " (" + p.referencia + ")" : ""} a ${p.cliente_nombre || "un proveedor"}: el proveedor confirma recepción. Sin cruce de cobro.`.slice(0, 300);
          } else {
            const abiertasSoc = sociedad ? facturas.filter((f) => f.sociedad_id === sociedad) : facturas;
            const cruce = cruzarPago(
              { cliente_nombre: p.cliente_nombre, cliente_cuit: p.cliente_cuit, monto_neto: p.monto_neto, monto_total: p.monto_total, retenciones_total: p.retenciones_total, fecha_pago: p.fecha_pago, facturas: p.facturas },
              abiertasSoc, entradas.filter((e) => !sociedad || e.sociedad_id === sociedad || !e.sociedad_id));
            if (!cruce.entrada_banco && extractoHasta && p.fecha_pago && String(p.fecha_pago).slice(0, 10) > extractoHasta) {
              cruce.notas.push(`El extracto cargado llega hasta el ${extractoHasta.split("-").reverse().join("/")}: falta cargar el extracto del banco para ver la entrada.`);
            }
            datos.cruce = cruce;
            if (!sociedad && cruce.facturas.length) sociedad = facturas.find((f) => f.id === cruce.facturas[0].id)?.sociedad_id || null;
            const pendientesCobro = cruce.facturas.filter((f) => !f.cobrada);
            if (pendientesCobro.length) accion = `Cargar el cobro de ${pendientesCobro.map((f) => f.etiqueta).join(", ")}${cruce.entrada_banco ? (cruce.entrada_banco.ya_cruzada ? "; la entrada del banco ya está cruzada" : " y cruzar con la entrada del banco del " + cruce.entrada_banco.fecha.slice(0, 10)) : "; todavía no se ve la entrada en el extracto"} (confianza ${cruce.confianza}).`.slice(0, 300);
            else if (cruce.facturas.length) accion = `${cruce.facturas.map((f) => f.etiqueta).join(", ")} ya figura cobrada en el CRM: solo archivar el comprobante y la retención.`.slice(0, 300);
            else if (cruce.entrada_banco) accion = `Hay una entrada del banco por ese monto (${cruce.entrada_banco.fecha.slice(0, 10)}); falta ubicar la factura.`;
            else accion = `Pago de ${p.cliente_nombre || "un cliente"} por $ ${Number(p.monto_neto || p.monto_total || 0).toLocaleString("es-AR")}: no encontré la factura ni la entrada del banco; revisar a mano.`.slice(0, 300);
          }
        }
        if (adjuntosInfo.some((a) => a.metodo === "revisar_a_mano")) accion = (accion + " ⚠️ Hay un adjunto para revisar a mano.").trim();

        fila = {
          sociedad_id: sociedad || SOCIEDAD_LAZZARI, gmail_message_id: msg.id, gmail_thread_id: msg.threadId, fecha_mail: msg.fecha,
          remitente: msg.remitente.slice(0, 300), asunto: msg.asunto.slice(0, 300), categoria,
          prioridad: ["alta", "normal", "baja"].includes(clasif.prioridad) ? clasif.prioridad : info.prioridad,
          resumen, accion_sugerida: accion, datos, adjuntos: adjuntosInfo.length ? adjuntosInfo : null,
          costo_usd: Number((uso.costo - antes).toFixed(5)),
        };
      } catch (e: any) {
        // Un mail que falla no frena a los demás: queda anotado para revisarlo a mano.
        fila = { sociedad_id: SOCIEDAD_LAZZARI, gmail_message_id: id, categoria: "otro", prioridad: "normal", resumen: "No se pudo leer este mail.",
          accion_sugerida: "Revisarlo a mano en Gmail.", error: String(e?.message || e).slice(0, 300), costo_usd: Number((uso.costo - antes).toFixed(5)) };
      }
      const { error: eIns } = await db.from("agente_mail_procesados").insert(fila);
      total.costo += uso.costo; total.entrada += uso.entrada; total.salida += uso.salida;
      if (eIns) { error = `No se pudo guardar: ${eIns.message}`; return; }
      nuevos++;
      porCategoria.set(fila.categoria, (porCategoria.get(fila.categoria) || 0) + 1);
      porSociedad.set(fila.sociedad_id, (porSociedad.get(fila.sociedad_id) || 0) + 1);
      if (fila.prioridad === "alta" && urgentes.length < 5) urgentes.push(`${fila.asunto || "(sin asunto)"}: ${fila.accion_sugerida || fila.resumen}`);
    };
    // De a EN_PARALELO mails a la vez: la ruta tiene 60 s y cada mail con PDF tarda varios segundos.
    for (let k = 0; k < pendientes.length; k += EN_PARALELO) {
      if (nuevos >= MAX_MAILS_POR_CORRIDA || Date.now() - inicio > PRESUPUESTO_MS || error) break;
      if (superaTopeDiario(gastadoHoy + total.costo)) { topeado = true; break; }
      await Promise.all(pendientes.slice(k, k + EN_PARALELO).map(procesarUno));
    }
    faltan = Math.max(0, pendientes.length - nuevos);
  } catch (e: any) {
    error = String(e?.message || e);
  }

  const partes = CATEGORIAS_MAIL.filter((c) => porCategoria.get(c.id)).map((c) => `${porCategoria.get(c.id)} ${c.label.toLowerCase()}`);
  const resumen = error ? `Error: ${error}`
    : nuevos ? `${nuevos} mail${nuevos === 1 ? "" : "s"} nuevo${nuevos === 1 ? "" : "s"}: ${partes.join(", ")}.${urgentes.length ? " Urgente: " + urgentes.join(" | ") : ""}${topeado ? " (Se llegó al tope de gasto diario; sigue en la próxima corrida.)" : ""}`
    : "Sin mails nuevos.";

  if (corrida?.id) {
    await db.from("agente_mail_corridas").update({
      fin: new Date().toISOString(), mails_nuevos: nuevos, pendientes_restantes: faltan, costo_usd: Number(total.costo.toFixed(5)), topeado, resumen, error: error || null,
    }).eq("id", corrida.id);
  }
  if (total.entrada || total.salida) {
    await db.from("ia_uso").insert({ funcion: "agente_mail", modelo: MODELO, tokens_entrada: total.entrada, tokens_salida: total.salida }).then(() => {}, () => {});
  }
  // Aviso en la campana (solo si hay novedades). Es un aviso, nunca bloquea nada.
  if (nuevos) {
    for (const [sociedad_id, n] of porSociedad) {
      await db.from("notificaciones").insert({
        sociedad_id, tipo: "agente_mail", titulo: `Mail y cobros: ${n} mail${n === 1 ? "" : "s"} nuevo${n === 1 ? "" : "s"} en administración`,
        detalle: resumen.slice(0, 500), referencia_tipo: "pagina", referencia_id: null,
      }).then(() => {}, () => {});
    }
  }
  return { ok: !error, nuevos, faltan, costo_usd: Number(total.costo.toFixed(5)), topeado, resumen, error };
}
