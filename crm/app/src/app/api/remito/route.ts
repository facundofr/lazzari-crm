import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Do not submit general remitos to FECAESolicitar as invoices (type 91).
 * WSFEv1 documents invoice classes A/B/C/M, not general remito authorization.
 * Source: https://www.afip.gob.ar/ws/documentacion/ws-factura-electronica.asp
 * The applicable CAI / autoimpresor workflow must be configured separately.
 * Fail closed for old clients, without requesting WSAA tickets, issuing
 * fiscal documents, or altering any existing remito.
 */
export async function POST() {
  return NextResponse.json({
    code: "REMITO_AUTHORIZATION_NOT_CONFIGURED",
    error: "La autorización fiscal de remitos todavía no está configurada. Un remito R no se autoriza como factura por WSFE. Verificá el circuito de CAI/autoimpresión correspondiente; no se emitió ni modificó ningún comprobante.",
  }, { status: 501 });
}
