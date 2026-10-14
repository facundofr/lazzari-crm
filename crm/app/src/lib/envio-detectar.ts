// Detecta si un renglón (de una factura de proveedor, por ejemplo) es un envío / flete.
// Los proveedores lo escriben de muchas formas: "Envío", "Flete", "Fletes", "Costo de transporte", "Traslado", "Despacho", "Entrega a domicilio"...
// Es solo una sugerencia para preguntarle al usuario: nunca decide ni bloquea nada.

const PALABRAS_ENVIO = [
  "envio", "envios", "flete", "fletes", "fletero", "transporte", "transportes", "traslado", "traslados",
  "despacho", "despachos", "encomienda", "encomiendas", "acarreo", "mensajeria", "courier", "correo",
  "logistica", "reparto", "distribucion", "delivery", "shipping", "freight",
];
// Frases que parecen envío pero no lo son (producto, no servicio de traslado).
const NO_ES_ENVIO = ["caja de envio", "bolsa de envio", "cinta de embalaje", "sobre de envio", "etiqueta de envio"];

function normalizar(texto: string): string {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function esRenglonEnvio(descripcion: string, codigo?: string | null): boolean {
  const d = normalizar(descripcion);
  if (!d) return false;
  if (NO_ES_ENVIO.some((f) => d.includes(f))) return false;
  const palabras = new Set(d.split(" "));
  if (PALABRAS_ENVIO.some((p) => palabras.has(p))) return true;
  // "entrega" sola es ambigua: solo cuenta si es el renglón entero o dice a domicilio / a obra / flete.
  if (/^(entrega|entrega a domicilio|entrega a obra|entrega en obra)$/.test(d)) return true;
  const c = normalizar(codigo || "");
  return c === "envio" || c === "flete";
}
