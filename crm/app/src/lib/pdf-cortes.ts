/**
 * Corta en hojas A4 el HTML de un PDF antes de pasarlo a imagen (html2pdf).
 *
 * html2pdf, con `pagebreak: avoid-all`, mete <div> de relleno ANTES de cualquier elemento
 * que cruce el corte de hoja, también adentro de las tablas (antes de un <tbody> o un <tr>).
 * Un <div> adentro de una tabla la desarma: las columnas pierden el ancho y la descripción
 * queda en una columna finita (remito 0018-00000123: 28 renglones en 6 hojas, 29/10/2026).
 *
 * Acá se empuja a la hoja siguiente sin romper nada:
 * - renglones de tabla: un <tr> vacío del alto que falta y se repite el encabezado de la tabla;
 * - bloques sueltos (datos, firmas, CAI, totales): un <div> antes, solo afuera de las tablas;
 * - títulos chicos (ej. "Detalle de mercadería"): no quedan solos al pie de la hoja.
 */

const MARGEN_HOJA = 45; // ≈ 12 mm, el mismo margen de arriba que tiene .page
const TABLA_LARGA = 260; // tablas más altas que esto se cortan por renglón

function arriba(el: Element, base: number) {
  return el.getBoundingClientRect().top - base;
}

function abajo(el: Element, base: number) {
  return el.getBoundingClientRect().bottom - base;
}

/** Alto que falta para terminar la hoja en la que empieza `y`. */
function faltaParaElCorte(y: number, altoHoja: number) {
  return altoHoja - (y % altoHoja);
}

function cruzaElCorte(top: number, bottom: number, altoHoja: number) {
  return Math.floor(top / altoHoja) !== Math.floor((bottom - 1) / altoHoja) && bottom - top <= altoHoja;
}

/** Lo que falta para dejar el margen de arriba si el elemento quedó pegado al borde de una hoja nueva. */
function faltaMargenArriba(top: number, altoHoja: number) {
  if (top < altoHoja) return 0;
  const enLaHoja = top % altoHoja;
  return enLaHoja < MARGEN_HOJA ? MARGEN_HOJA - enLaHoja : 0;
}

function rengloVacio(columnas: number, alto: number) {
  const tr = document.createElement("tr");
  tr.className = "pdf-corte";
  const td = document.createElement("td");
  td.colSpan = columnas;
  td.style.cssText = `height:${Math.ceil(alto)}px;padding:0;border:0;background:transparent;`;
  tr.appendChild(td);
  return tr;
}

function relleno(alto: number) {
  const d = document.createElement("div");
  d.className = "pdf-corte";
  d.style.cssText = `display:block;height:${Math.max(0, Math.ceil(alto))}px;`;
  return d;
}

/** Copia el renglón de encabezado con sus estilos, para repetirlo arriba de la hoja nueva. */
function encabezadoRepetido(tabla: HTMLTableElement): HTMLTableRowElement | null {
  const fila = tabla.tHead?.rows[0];
  if (!fila) return null;
  const copia = fila.cloneNode(true) as HTMLTableRowElement;
  copia.className = "pdf-encabezado-repetido";
  Array.from(fila.cells).forEach((celda, i) => {
    const cs = window.getComputedStyle(celda);
    const c = copia.cells[i] as HTMLElement | undefined;
    if (!c) return;
    c.style.cssText = [
      `background:${cs.backgroundColor}`, `color:${cs.color}`, `font-size:${cs.fontSize}`, `font-weight:${cs.fontWeight}`,
      `letter-spacing:${cs.letterSpacing}`, `text-align:${cs.textAlign}`, `padding:${cs.padding}`,
      `border-bottom:${cs.borderBottomWidth} ${cs.borderBottomStyle} ${cs.borderBottomColor}`,
    ].join(";");
  });
  return copia;
}

function cortarTabla(tabla: HTMLTableElement, base: number, altoHoja: number) {
  const cuerpo = tabla.tBodies[0];
  if (!cuerpo) return;
  const columnas = tabla.tHead?.rows[0]?.cells.length || cuerpo.rows[0]?.cells.length || 1;
  // Se recorre una copia de la lista: al insertar renglones, cuerpo.rows cambia.
  for (const fila of Array.from(cuerpo.rows)) {
    const top = arriba(fila, base);
    const bottom = abajo(fila, base);
    const alto = cruzaElCorte(top, bottom, altoHoja)
      ? faltaParaElCorte(top, altoHoja) + MARGEN_HOJA
      : faltaMargenArriba(top, altoHoja);
    if (!alto) continue;
    cuerpo.insertBefore(rengloVacio(columnas, alto), fila);
    const enc = encabezadoRepetido(tabla);
    if (enc) cuerpo.insertBefore(enc, fila);
  }
}

/**
 * Acomoda los cortes de hoja del contenedor (ya en pantalla, con su ancho final).
 * `altoHoja` es el alto de una hoja A4 en px al ancho del contenedor.
 */
export function acomodarCortesDeHoja(contenedor: HTMLElement, altoHoja: number) {
  const pagina = (contenedor.querySelector(".page") as HTMLElement | null) || contenedor;
  const base = contenedor.getBoundingClientRect().top;
  const bloques = Array.from(pagina.children).filter((el) => !(el instanceof HTMLStyleElement));

  bloques.forEach((el, i) => {
    const top = arriba(el, base);
    const bottom = abajo(el, base);
    const alto = bottom - top;
    if (alto <= 0) return;

    if (el instanceof HTMLTableElement && alto > TABLA_LARGA) {
      cortarTabla(el, base, altoHoja);
      return;
    }

    // Título chico que queda al pie de la hoja y lo que sigue pasa a la otra: se va con lo que sigue.
    const siguiente = bloques[i + 1];
    if (alto < 40 && siguiente) {
      const finHoja = (Math.floor(top / altoHoja) + 1) * altoHoja;
      const primeraParte = siguiente instanceof HTMLTableElement ? (siguiente.rows[1] || siguiente.rows[0]) : siguiente;
      if (primeraParte && abajo(primeraParte, base) > finHoja && top < finHoja) {
        el.parentNode?.insertBefore(relleno(faltaParaElCorte(top, altoHoja) + MARGEN_HOJA), el);
        return;
      }
    }

    const falta = cruzaElCorte(top, bottom, altoHoja)
      ? faltaParaElCorte(top, altoHoja) + MARGEN_HOJA
      : faltaMargenArriba(top, altoHoja);
    if (falta) el.parentNode?.insertBefore(relleno(falta), el);
  });
}
