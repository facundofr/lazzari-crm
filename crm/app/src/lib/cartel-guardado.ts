// Textos del cartel verde al guardar (auditoría UX 27/10/2026, arreglo 2): «OP-000091 guardada», «Recibo N° 1040 registrado».

const unirNumeros = (numeros: number[]) => (numeros.length <= 1 ? `${numeros[0]}` : `${numeros.slice(0, -1).join(", ")} y ${numeros[numeros.length - 1]}`);

/** «Recibo N° 1040 registrado»; sin número (no se pudo leer) queda «Recibo registrado». */
export function textoRecibo(numeros: number[]): string {
  const unicos = [...new Set(numeros.filter((n) => Number.isFinite(n)))].sort((a, b) => a - b);
  if (!unicos.length) return "Recibo registrado";
  return unicos.length === 1 ? `Recibo N° ${unicos[0]} registrado` : `Recibos N° ${unirNumeros(unicos)} registrados`;
}

/** Cobro en $ o US$: el recibo y cuántas facturas cobró. */
export function textoCobro(numeros: number[], facturas: number): string {
  return facturas > 0 ? `${textoRecibo(numeros)} · ${facturas} factura${facturas === 1 ? "" : "s"}` : textoRecibo(numeros);
}

/** OP guardada; con «Guardar y enviar» avisa que sigue el mail. */
export function textoOP(numero: string, enviar: boolean): string {
  return `${numero || "OP"} guardada${enviar ? " · ahora el mail al proveedor" : ""}`;
}
