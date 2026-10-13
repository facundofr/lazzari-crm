// WhatsApp argentino en dos partes: característica (sin 0) y número (sin 15). Se guarda como "2477 688498".
// Así todos los números quedan cargados igual y el link de WhatsApp sale bien (+54 9 + característica + número).

// Características de 3 dígitos (el resto del país usa 4; Buenos Aires usa 11).
const AREAS_3 = new Set([
  "220", "221", "223", "230", "236", "237", "249", "260", "261", "263", "264", "266", "280", "291", "294", "297", "298", "299",
  "336", "341", "342", "343", "345", "348", "351", "353", "358", "362", "364", "370", "376", "379", "380", "381", "383", "385", "387", "388",
]);

export interface WhatsAppAR { area: string; numero: string }

/** Deja solo los dígitos del número local (10 dígitos: característica + número), sin 54, 9, 0 ni 15. */
function digitosLocales(raw: string): string {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.startsWith("54")) d = d.slice(2);
  if (d.startsWith("9") && d.length === 11) d = d.slice(1);
  if (d.startsWith("0")) d = d.slice(1);
  if (d.length === 12) {
    // "11 15 5555-1234" / "2477 15 68-8498": el 15 va después de la característica.
    for (const n of [2, 3, 4]) if (d.slice(n, n + 2) === "15") { const s = d.slice(0, n) + d.slice(n + 2); if (s.length === 10) return s; }
  }
  return d;
}

function largoArea(d: string): number {
  if (d.startsWith("11")) return 2;
  if (AREAS_3.has(d.slice(0, 3))) return 3;
  return 4;
}

/** Separa un número ya cargado ("+54 9 2477 68-8498", "011 15-5555-1234", "2477 688498") en característica y número. */
export function separarWhatsApp(raw: string | null | undefined): WhatsAppAR {
  const texto = String(raw || "").trim();
  if (!texto) return { area: "", numero: "" };
  const d = digitosLocales(texto);
  if (d.length !== 10) {
    // No se puede saber dónde corta: si venía con un espacio, se respeta lo que escribió la persona.
    const partes = texto.replace(/^\+?54\s*9?\s*/, "").split(/\s+/).filter(Boolean);
    if (partes.length >= 2) return { area: partes[0].replace(/\D/g, "").replace(/^0/, ""), numero: partes.slice(1).join("").replace(/\D/g, "") };
    return { area: "", numero: d };
  }
  const n = largoArea(d);
  return { area: d.slice(0, n), numero: d.slice(n) };
}

/** Une característica y número como se guarda en la base: "2477 688498". Vacío si no hay nada. */
export function unirWhatsApp(area: string, numero: string): string {
  let a = String(area || "").replace(/\D/g, "").replace(/^0+/, "");
  let n = String(numero || "").replace(/\D/g, "");
  if (n.startsWith("15") && (a.length + n.length) === 12) n = n.slice(2);
  if (!a && !n) return "";
  return a ? `${a} ${n}` : n;
}

/** Aviso (nunca bloquea): característica + número tienen que sumar 10 dígitos. "" si está bien o vacío. */
export function avisoWhatsApp(area: string, numero: string): string {
  const a = String(area || "").replace(/\D/g, "").replace(/^0+/, "");
  const n = String(numero || "").replace(/\D/g, "");
  if (!a && !n) return "";
  if (!a) return "Falta la característica (ej. 11, 341, 2477).";
  if (a.length < 2 || a.length > 4) return "La característica tiene entre 2 y 4 dígitos (sin el 0).";
  if (a.length + n.length !== 10) return `Característica + número tienen que sumar 10 dígitos (hoy ${a.length + n.length}). El número va sin el 15.`;
  return "";
}

/** Para mostrar: "2477 68-8498" / "11 5555-1234". */
export function mostrarWhatsApp(raw: string | null | undefined): string {
  const { area, numero } = separarWhatsApp(raw);
  if (!area) return numero || String(raw || "");
  const corte = numero.length - 4;
  return `${area} ${corte > 0 ? `${numero.slice(0, corte)}-${numero.slice(corte)}` : numero}`;
}
