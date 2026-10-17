/**
 * Fetches email templates from the email_templates table and applies variables.
 * Falls back to defaults if no custom template is saved.
 */

import { supabase } from "@/lib/supabase/client";

export type EmailTemplateTipo = "presupuesto" | "factura" | "remito" | "orden_compra" | "orden_pago";

interface EmailTemplate {
  asunto: string;
  cuerpo: string;
}

const DEFAULTS: Record<EmailTemplateTipo, EmailTemplate> = {
  presupuesto: {
    asunto: "Presupuesto {{numero}} — {{sociedad}}",
    cuerpo: "Estimado/a,\n\nAdjuntamos el presupuesto {{numero}} por un total de {{total}}.\n\nQuedamos a disposición para cualquier consulta.\n\nSaludos,\n{{sociedad}}",
  },
  factura: {
    asunto: "{{comprobante}} — {{sociedad}}",
    cuerpo: "Estimado/a,\n\nAdjuntamos la factura {{comprobante}} por un total de {{total}}.\n\nSaludos,\n{{sociedad}}",
  },
  remito: {
    asunto: "Remito {{numero}} — {{sociedad}}",
    cuerpo: "Estimado/a,\n\nAdjuntamos el remito {{numero}} con fecha {{fecha}}.\n\nSaludos,\n{{sociedad}}",
  },
  orden_compra: {
    asunto: "{{numero}} — {{sociedad}}",
    cuerpo: "Estimado/a,\n\nAdjuntamos la orden de compra N° {{numero}} por un total de {{total}}.\n\nQuedamos a disposición ante cualquier consulta.\n\nSaludos,\n{{sociedad}}",
  },
  orden_pago: {
    asunto: "Orden de pago {{numero}} — {{sociedad}}",
    cuerpo: "Estimado/a,\n\nAdjuntamos la orden de pago {{numero}} por un total de {{total}}.\n\nSaludos,\n{{sociedad}}",
  },
};

// Map from our EmailTemplateTipo to the DB tipo values used in configuracion
const DB_TIPO_MAP: Record<EmailTemplateTipo, string> = {
  presupuesto: "presupuesto",
  factura: "factura",
  remito: "remito",
  orden_compra: "orden_compra",
  orden_pago: "orden_pago",
};

/**
 * Load email template from DB (email_templates table), fall back to defaults.
 */
export async function loadEmailTemplate(
  tipo: EmailTemplateTipo,
  sociedadId: string
): Promise<EmailTemplate> {
  try {
    const dbTipo = DB_TIPO_MAP[tipo];
    const { data } = await (supabase as any)
      .from("email_templates")
      .select("asunto, cuerpo")
      .eq("sociedad_id", sociedadId)
      .eq("tipo", dbTipo)
      .maybeSingle();

    if (data?.asunto || data?.cuerpo) {
      return {
        asunto: data.asunto || DEFAULTS[tipo].asunto,
        cuerpo: data.cuerpo || DEFAULTS[tipo].cuerpo,
      };
    }
  } catch {
    // Fall back to defaults
  }
  return { ...DEFAULTS[tipo] };
}

/**
 * Replace {{variable}} placeholders with actual values.
 */
export function applyTemplateVars(
  text: string,
  vars: Record<string, string>
): string {
  let result = text;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }
  return result;
}
