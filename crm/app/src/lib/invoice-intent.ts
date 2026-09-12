"use client";

type Intent = { key: string; confirmed: boolean };
const PREFIX = "lazzari.invoice-intent.v1:";
const memory = new Map<string, Intent>();
const flights = new Map<string, Promise<Response>>();
const requestedNewIntent = new Map<string, string>();

function read(scope: string): Intent | undefined {
  try {
    const stored = localStorage.getItem(PREFIX + scope);
    if (stored) {
      const value = JSON.parse(stored);
      if (typeof value.key === "string" && /^[0-9a-f-]{36}$/i.test(value.key)) return value;
    }
  } catch { /* Storage unavailable: retain the in-memory intent, never replace on retry. */ }
  return memory.get(scope);
}
function write(scope: string, value: Intent) {
  try { localStorage.setItem(PREFIX + scope, JSON.stringify(value)); }
  catch { throw new Error("No se puede guardar la protección contra facturas duplicadas en este navegador. Habilitá el almacenamiento antes de emitir."); }
  memory.set(scope, value);
}
function ensure(scope: string): Intent {
  let intent = read(scope);
  if (!intent) { intent = { key: crypto.randomUUID(), confirmed: false }; write(scope, intent); }
  return intent;
}

/** Call only when opening a new form, not on submit or after an error. */
export function beginInvoiceIntent(scope: string) {
  const previous = read(scope);
  if (previous?.confirmed && !flights.has(scope)) {
    // Remember the observed completed key; rotation occurs exclusively under
    // the cross-tab lock. Another tab rotating it first must not rotate twice.
    requestedNewIntent.set(scope, previous.key);
  }
}

/** One durable key per intent, including retries after ambiguous network failures. */
export async function postInvoiceIntent(scope: string, init: RequestInit): Promise<Response> {
  let pending = flights.get(scope);
  if (!pending) {
    if (typeof navigator === "undefined" || !navigator.locks?.request) {
      throw new Error("Este navegador no permite bloquear emisiones simultáneas entre pestañas. Usá un navegador actualizado con conexión segura para emitir.");
    }
    pending = navigator.locks.request(PREFIX + scope, { mode: "exclusive" }, async () => {
      let intent = ensure(scope);
      if (requestedNewIntent.get(scope) === intent.key && intent.confirmed) {
        intent = { key: crypto.randomUUID(), confirmed: false };
        write(scope, intent);
      }
      requestedNewIntent.delete(scope);
      const headers = new Headers(init.headers);
      headers.set("Idempotency-Key", intent.key);
      const response = await fetch("/api/facturacion", { ...init, method: "POST", headers });
      // Only an explicit successful server result ends this intent. HTTP errors,
      // invalid JSON, timeouts and dropped responses must preserve its key.
      const data = await response.clone().json().catch(() => null);
      if (((response.ok && data?.success === true) || data?.emission_completed === true) && data?.reconciliation_required !== true) {
        // The pending key is already durable; a failure to mark success must not
        // hide the successful fiscal response or produce another UUID.
        try { write(scope, { key: intent.key, confirmed: true }); } catch { /* Keep pending durable key. */ }
      }
      return response;
    }).then(response => response);
    flights.set(scope, pending);
  }
  try { return (await pending).clone(); }
  finally { if (flights.get(scope) === pending) flights.delete(scope); }
}
