// Banco simple (Augusto 29–30/10/2026: "que el banco se clasifique solo, sin duplicar y sin confirmar nada"; OK "Sí, dale a todo").
// Decide qué es cada línea PENDIENTE del extracto, solo con reglas seguras (sin IA):
//  1. Por el código del banco: impuestos, comisiones, IVA, intereses, FCI, pases entre cuentas propias y pago de tarjeta → "del banco".
//  2. Cheques: débito de un cheque propio (N° + importe, o solo importe si hay un único cheque posible), depósito de un cheque recibido
//     (también uno que después rebotó) y rechazo de un cheque recibido (el de papel se rechaza en el CRM: el banco manda).
//  3. Transferencias, débitos y VEP: se cruzan con el cobro, pago, OP o gasto que YA cargó una persona, solo si la coincidencia es
//     única y exacta (el CUIT de la línea manda; importe exacto y único; el mismo día; pagos iguales de la misma contraparte; una
//     línea = varios movimientos del mismo cliente, proveedor o persona que suman exacto). Con dos posibles no adivina: queda
//     "sin cruzar". Augusto 30/10: si la línea trae el CUIT de otro, o los que suman son de clientes o proveedores distintos, no se
//     cruza sola.
// El banco nunca crea ni asigna plata: solo dice qué línea es qué movimiento que cargó una persona. Probado contra las 774 líneas
// reales el 29/10 (docs/traspaso/plan-banco-simple.md §5: 95 % solas, 0 cruces equivocados).
import { cruzarExtracto, digitosCuenta, normalizarLinea, type ChequeCruce, type ClasificacionLinea, type CuentaCruce, type LineaCruce, type MovCruce } from "./extracto-bbva";
import { familiaDeCodigo } from "./bbva-codigos";
import { clasificarMovimiento } from "./tipos-movimiento";
import { cuitValido } from "./factura-texto";

/** CUIT de las personas del equipo: una transferencia con su CUIT cruza con sus sueldos, premios o reintegros (por el nombre). */
export const PERSONAS_EQUIPO: Record<string, string> = { "20379309128": "Augusto", "20372644606": "Jerónimo", "27339634578": "Mariana" };

/** CUIT que trae el texto de la línea (prefijo de CUIT y dígito verificador bien: un N° de cuenta de 11 dígitos no cuenta). */
export function cuitDeLinea(concepto: string): string | null {
  for (const m of String(concepto || "").matchAll(/\b((?:20|23|24|27|30|33|34)\d{9})\b/g)) if (cuitValido(m[1])) return m[1];
  return null;
}

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const PALABRA = "[A-ZÁÉÍÓÚÑÜ][A-Za-zÁÉÍÓÚÑÜáéíóúñü'.]*";
const NOMBRE = new RegExp(`^${PALABRA}(?:\\s+${PALABRA})+$`);

/**
 * Nombres de persona en el texto de un gasto, para juntar los gastos de una misma persona sin proveedor:
 * "Comisión septiembre 2026 — José Alvarez" → ["jose alvarez"] (una parte separada por raya, de dos o más palabras con mayúscula).
 */
export function nombresDePersona(texto: string): string[] {
  return String(texto || "").split(/\s+[—–-]\s+/).map((s) => s.trim()).filter((s) => NOMBRE.test(s)).map(sinTildes);
}

/** Lo que es plata del banco (no la carga nadie en el CRM): ya cuenta en Reportes y la Contabilidad desde la línea. */
const DEL_BANCO = new Set(["impuesto", "gasto_bancario", "intereses", "fci", "entre_cuentas", "tarjeta"]);

export interface MovMotor extends MovCruce {
  orden_pago_id?: string | null;
  proveedor_id?: string | null;
  cliente_id?: string | null;
  /** Texto para reconocer a una persona del equipo: descripción del movimiento y de su gasto. */
  texto?: string | null;
  /** Cuenta donde se cargó (para el control "cargado en el CRM que no pasó por el banco"). */
  cuenta_id?: string | null;
}

export interface DecisionBanco {
  linea_id: string;
  estado: "cruzada" | "del_banco" | "sin_cruzar";
  clasificacion: ClasificacionLinea | null;
  subtipo: string | null;
  /** Movimientos del CRM que explica la línea (una línea puede pagar o cobrar varios). */
  movimientos: string[];
  cheque_id: string | null;
  contra_cuenta_id: string | null;
  motivo: string;
  /** Cheque de papel recibido rechazado que coincide con uno solo: se rechaza en el CRM (Augusto 30/10: aplicar y avisar). */
  rechazar_cheque?: boolean;
  /** Para la campana (una vez por línea): cheque de papel rechazado, cheque propio rechazado o uno que no se sabe cuál es. */
  aviso?: string;
}

export interface EntradaMotor {
  /** Líneas pendientes (las ya resueltas no se tocan). */
  lineas: LineaCruce[];
  /** Movimientos del CRM que todavía no están cruzados con ninguna línea. */
  movimientos: MovMotor[];
  cheques: ChequeCruce[];
  cuentas: CuentaCruce[];
  /** Cheques ya enlazados a otra línea, por clasificación ("cheque_emitido:<id>"). */
  chequesUsados?: Set<string>;
  /** Cruces que una persona desató ("<linea_id>|<movimiento_id>", o "<linea_id>|*" para no tocar la línea): no se vuelven a hacer. */
  prohibidos?: Set<string>;
  personas?: Record<string, string>;
}

const cent = (v: number | string) => Math.round(Number(v) * 100);
const pesos = (v: number | string) => `$ ${Math.abs(Number(v)).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dias = (a: string, b: string) => Math.round((Date.parse(`${b.slice(0, 10)}T12:00:00Z`) - Date.parse(`${a.slice(0, 10)}T12:00:00Z`)) / 86_400_000);
const sumarDias = (f: string, n: number) => { const d = new Date(`${f.slice(0, 10)}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** Cuenta del otro lado de un pase, FCI o pago de tarjeta (sin ella no se puede mover el saldo de la otra cuenta). */
function contraCuenta(clas: string, concepto: string, cuentaId: string | null, cuentas: CuentaCruce[]): string | null {
  const activas = cuentas.filter((x) => x.activa !== false);
  const c = concepto.toUpperCase();
  if (clas === "fci") {
    const fci = activas.filter((x) => x.tipo === "fci" && x.moneda === "ARS");
    return fci.length === 1 ? fci[0].id : null;
  }
  if (clas === "entre_cuentas") {
    const m = c.match(/\bCA?[CP]P?\s?(\d{3})\s(\d{6})\s(\d)\b/);
    if (!m) return null;
    const dig = digitosCuenta(m.slice(1).join(""));
    const otras = activas.filter((x) => x.id !== cuentaId && digitosCuenta(x.numero) === dig);
    return otras.length === 1 ? otras[0].id : null;
  }
  if (clas === "tarjeta") {
    const t = c.match(/(VISA|MASTERCARD)(?: NRO\.?\s*(\d+))?/);
    if (!t) return null;
    const tarjetas = activas.filter((x) => x.tipo === "tarjeta_credito");
    const porNumero = t[2] ? tarjetas.filter((x) => digitosCuenta(x.numero) && t[2].includes(digitosCuenta(x.numero))) : [];
    if (porNumero.length === 1) return porNumero[0].id;
    const porMarca = tarjetas.filter((x) => x.nombre.toUpperCase().includes(t[1] === "MASTERCARD" ? "MASTER" : "VISA"));
    return porMarca.length === 1 ? porMarca[0].id : null;
  }
  return null;
}

/**
 * Qué es cada línea pendiente. Devuelve una decisión por línea, en el orden de las fechas.
 * Las "cruzada" y "del_banco" se aplican solas; las "sin_cruzar" quedan a la vista (falta cargar algo, o hay dos posibles).
 */
export function motorBanco(x: EntradaMotor): DecisionBanco[] {
  const prohibidos = x.prohibidos || new Set<string>();
  const personas = x.personas || PERSONAS_EQUIPO;
  const lineas = x.lineas.filter((l) => !prohibidos.has(`${l.id}|*`)).map((l) => ({ ...normalizarLinea(l), clasificacion: null }));
  const props = cruzarExtracto(lineas, [], x.cheques, x.cuentas, [], x.chequesUsados || new Set());
  const porId = new Map(lineas.map((l) => [l.id, l]));
  const res = new Map<string, DecisionBanco>();
  const chUsados = new Set<string>(x.chequesUsados || []);
  for (const p of props) if (p.cheque_id && p.auto) chUsados.add(`${p.clasificacion}:${p.cheque_id}`);
  const resto: (LineaCruce & { codigo: string | null; vep: boolean })[] = [];
  const decision = (l: { id: string }, d: Omit<DecisionBanco, "linea_id" | "movimientos" | "cheque_id" | "contra_cuenta_id" | "subtipo"> & Partial<DecisionBanco>) =>
    res.set(l.id, { movimientos: [], cheque_id: null, contra_cuenta_id: null, subtipo: null, ...d, linea_id: l.id });

  for (const p of props) {
    const l = porId.get(p.linea_id)!;
    const clas = String(p.clasificacion || "");
    const fam = familiaDeCodigo(l.codigo);
    // ── Cheques ──
    // El débito de un cheque propio sin N° en la línea (código 005/016) llega como "pago": se busca igual por el cheque.
    if (clas === "cheque_emitido" || (fam === "cheque_debito" && l.importe < 0)) {
      if (p.auto && p.cheque_id) { decision(l, { estado: "cruzada", clasificacion: "cheque_emitido", cheque_id: p.cheque_id, motivo: p.motivo }); continue; }
      // Por importe, si hay un solo cheque emitido posible.
      const c = x.cheques.filter((ch) => ch.direccion === "emitido" && ch.estado !== "anulado" && !chUsados.has(`cheque_emitido:${ch.id}`)
        && cent(ch.monto) === cent(-l.importe) && (!ch.fecha_pago || (ch.fecha_pago <= l.fecha && dias(ch.fecha_pago, l.fecha) <= 60)));
      if (fam === "cheque_debito" && c.length === 1) {
        chUsados.add(`cheque_emitido:${c[0].id}`);
        decision(l, { estado: "cruzada", clasificacion: "cheque_emitido", cheque_id: c[0].id, motivo: `Cheque ${c[0].numero} (el banco no trae el N°: único por importe)` });
      } else decision(l, { estado: "sin_cruzar", clasificacion: "cheque_emitido", motivo: p.motivo });
      continue;
    }
    if (clas === "cheque_acreditado") {
      if (p.auto && p.cheque_id) { decision(l, { estado: "cruzada", clasificacion: "cheque_acreditado", cheque_id: p.cheque_id, motivo: p.motivo }); continue; }
      // Depósito de un cheque que después rebotó: primero se depositó.
      const c = x.cheques.filter((ch) => ch.direccion !== "emitido" && ["en_cartera", "depositado", "cobrado", "rechazado"].includes(ch.estado)
        && !chUsados.has(`cheque_acreditado:${ch.id}`) && cent(ch.monto) === cent(l.importe)
        && (!ch.fecha_pago || (ch.fecha_pago <= sumarDias(l.fecha, 3) && ch.fecha_pago >= sumarDias(l.fecha, -60))));
      if (c.length === 1) {
        chUsados.add(`cheque_acreditado:${c[0].id}`);
        decision(l, { estado: "cruzada", clasificacion: "cheque_acreditado", cheque_id: c[0].id, motivo: `Depósito del cheque ${c[0].numero}` });
      } else decision(l, { estado: "sin_cruzar", clasificacion: "cheque_acreditado", motivo: p.motivo });
      continue;
    }
    if (clas === "cheque_devuelto") {
      const ch = p.cheque_id ? x.cheques.find((c) => c.id === p.cheque_id) : null;
      if (ch && p.subtipo === "recibido" && ch.estado === "rechazado") {
        decision(l, { estado: "cruzada", clasificacion: "cheque_devuelto", subtipo: "recibido", cheque_id: ch.id, motivo: `Cheque ${ch.numero} rechazado (ya rechazado en el CRM)` });
      } else if (ch && p.subtipo === "recibido" && ch.tipo_cheque === "fisico") {
        decision(l, { estado: "cruzada", clasificacion: "cheque_devuelto", subtipo: "recibido", cheque_id: ch.id, rechazar_cheque: true,
          motivo: `Cheque de papel ${ch.numero} rechazado por el banco: se rechaza en el CRM`,
          aviso: `El banco rechazó el cheque de papel ${ch.numero}${ch.origen_nombre ? ` de ${ch.origen_nombre}` : ""} (${pesos(ch.monto)}): se marcó rechazado y la factura vuelve a deber.` });
      } else {
        // Sin resolver solo. A la campana (una vez): el cheque propio rechazado y el que no se sabe cuál es. El eCheq recibido se
        // rechaza en el CRM con el reporte de eCheq de rechazados (ese rechazo deja su propio aviso).
        const avisar = p.subtipo === "emitido" || !ch;
        decision(l, { estado: "sin_cruzar", clasificacion: "cheque_devuelto", subtipo: p.subtipo || null, motivo: p.motivo,
          aviso: avisar ? `Línea del banco del ${l.fecha.slice(8, 10)}/${l.fecha.slice(5, 7)} por ${pesos(l.importe)}: ${p.motivo}` : undefined });
      }
      continue;
    }
    // ── Del banco ──
    if (clas === "impuesto" && p.subtipo === "afip") { resto.push({ ...l, vep: true }); continue; }
    if (DEL_BANCO.has(clas) || (clas === "otro" && p.subtipo === "extraccion_efectivo")) {
      const necesitaContra = clas === "fci" || clas === "entre_cuentas" || clas === "tarjeta";
      const contra = p.contra_cuenta_id || (necesitaContra ? contraCuenta(clas, l.concepto, l.cuenta_id, x.cuentas) : null);
      if (necesitaContra && !contra && !(clas === "tarjeta" && l.importe > 0)) {
        decision(l, { estado: "sin_cruzar", clasificacion: p.clasificacion, subtipo: p.subtipo || null, motivo: `${p.motivo}: no sé con qué cuenta` });
      } else {
        decision(l, { estado: "del_banco", clasificacion: p.clasificacion, subtipo: p.subtipo || null, contra_cuenta_id: contra, motivo: p.motivo });
      }
      continue;
    }
    resto.push({ ...l, vep: false });
  }

  // ── Cobros, pagos, VEP y débitos: contra lo que ya cargó una persona ──
  const usados = new Set<string>();
  const contraparte = (m: MovMotor) => m.orden_pago_id || m.proveedor_id || m.cliente_id || null;
  // Pago de OP: vale la parte en transferencias (OP mixta con cheques) o el pago entero.
  const valor = (m: MovMotor) => (m.montoCuenta !== null && m.montoCuenta !== undefined ? Math.min(Number(m.montoCuenta), Number(m.monto)) : Number(m.monto));
  const digitos = (s: unknown) => String(s || "").replace(/\D/g, "");
  const cuitLinea = new Map(lineas.map((l) => [l.id, cuitDeLinea(l.concepto)]));
  // conCuit: si la línea trae un CUIT y el movimiento es de otro CUIT, no se cruzan solos (Augusto 30/10). Sin CUIT cargado, vale.
  const candidatos = (l: LineaCruce, conCuit = true) => x.movimientos.filter((m) => {
    if (usados.has(m.id) || prohibidos.has(`${l.id}|${m.id}`) || String(m.moneda || "ARS") !== "ARS") return false;
    const tipo = String(m.tipo || "");
    if (tipo.startsWith("retencion_") || ["cheque_recibido", "cheque_emitido", "echeq", "efectivo"].includes(tipo)) return false;
    const cuit = cuitLinea.get(l.id);
    if (conCuit && cuit && digitos(m.cuit) && digitos(m.cuit) !== cuit) return false;
    const clase = clasificarMovimiento(m);
    const d = dias(l.fecha, String(m.fecha));
    if (l.importe > 0) return clase === "ingreso" && d >= -10 && d <= 3;
    return clase === "egreso" && d >= -7 && d <= 5;
  }).filter((m) => (valor(m) > 0.005 && cent(valor(m)) <= cent(Math.abs(l.importe))) || cent(m.monto) === cent(Math.abs(l.importe)));
  const exactos = (l: LineaCruce, conCuit = true) => candidatos(l, conCuit).filter((m) => cent(valor(m)) === cent(Math.abs(l.importe)) || cent(m.monto) === cent(Math.abs(l.importe))
    || (m.montoCuenta !== null && m.montoCuenta !== undefined && cent(m.montoCuenta) === cent(Math.abs(l.importe))));
  const delCuit = (l: LineaCruce, cs: MovMotor[]) => {
    const cuit = cuitLinea.get(l.id);
    if (!cuit) return null;
    const persona = personas[cuit];
    return cs.filter((m) => digitos(m.cuit) === cuit || (persona && String(m.texto || m.descripcion || "").includes(persona)));
  };
  const combinaciones = (objetivo: number, cs: MovMotor[], max = 6) => {
    const xs = cs.map((m) => ({ id: m.id, v: cent(valor(m)) })).sort((a, b) => b.v - a.v);
    const sols: string[][] = [];
    const rec = (i: number, suma: number, sel: string[]) => {
      if (sols.length > 1) return;
      if (suma === objetivo && sel.length) { sols.push([...sel]); return; }
      if (sel.length === max) return;
      for (let j = i; j < xs.length; j++) {
        if (suma + xs[j].v > objetivo) continue;
        sel.push(xs[j].id); rec(j + 1, suma + xs[j].v, sel); sel.pop();
        if (sols.length > 1) return;
      }
    };
    rec(0, 0, []);
    return sols;
  };
  const cruzar = (l: (typeof resto)[number], ids: string[], motivo: string) => {
    for (const id of ids) usados.add(id);
    decision(l, { estado: "cruzada", clasificacion: l.vep ? "impuesto" : l.importe > 0 ? "cobro" : "pago", subtipo: l.vep ? "afip" : null, movimientos: ids, motivo });
  };
  const libres = () => resto.filter((l) => !res.has(l.id)).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id.localeCompare(b.id));
  const mismoImporte = (a: LineaCruce, b: LineaCruce) => a.id !== b.id && cent(a.importe) === cent(b.importe);

  // 1) El CUIT de la línea manda (proveedor, cliente o una persona del equipo).
  let cambio = true;
  while (cambio) {
    cambio = false;
    for (const l of libres()) {
      const conCuit = delCuit(l, candidatos(l));
      if (!conCuit || !conCuit.length) continue;
      const sols = combinaciones(cent(Math.abs(l.importe)), conCuit);
      if (sols.length === 1) { cruzar(l, sols[0], sols[0].length > 1 ? `Mismo CUIT: ${sols[0].length} movimientos suman exacto` : "Mismo CUIT e importe"); cambio = true; }
    }
  }
  cambio = true;
  while (cambio) {
    cambio = false;
    for (const l of libres()) {
      const ex = exactos(l);
      const otras = libres().filter((o) => mismoImporte(o, l) && exactos(o).some((m) => ex.some((y) => y.id === m.id)));
      // 2) Importe exacto y único para los dos lados.
      if (ex.length === 1 && !otras.length) { cruzar(l, [ex[0].id], "Importe exacto"); cambio = true; continue; }
      // 3) El mismo día: un solo movimiento ese día y ninguna otra línea igual ese día.
      const mismoDia = ex.filter((m) => String(m.fecha).slice(0, 10) === l.fecha.slice(0, 10));
      if (mismoDia.length === 1 && !otras.some((o) => o.fecha === l.fecha)) { cruzar(l, [mismoDia[0].id], "Importe exacto, el mismo día"); cambio = true; continue; }
      // 4) Varias líneas iguales contra varios pagos iguales de la MISMA contraparte (misma OP, proveedor o cliente): se aparean por fecha.
      if (otras.length && ex.length === otras.length + 1) {
        const grupo = [l, ...otras].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id.localeCompare(b.id));
        const movs = [...ex].sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)) || a.id.localeCompare(b.id));
        if (new Set(movs.map(contraparte)).size === 1 && contraparte(movs[0])) {
          grupo.forEach((g, i) => cruzar(g, [movs[i].id], "Pagos iguales de la misma contraparte"));
          cambio = true; continue;
        }
      }
    }
  }
  // 5) Una línea = varios movimientos del MISMO cliente, proveedor, OP o persona (suma exacta, una sola combinación posible).
  //    Augusto 30/10: de clientes o proveedores distintos no se juntan solos aunque sumen exacto. La persona de un gasto sin
  //    proveedor sale de su texto ("Comisión septiembre 2026 — José Alvarez").
  const conocidos = [...new Set(x.movimientos.flatMap((m) => nombresDePersona(String(m.texto || m.descripcion || ""))))];
  const quien = (m: MovMotor) => {
    if (m.cliente_id) return `c:${m.cliente_id}`;
    if (m.proveedor_id) return `p:${m.proveedor_id}`;
    if (m.orden_pago_id) return `op:${m.orden_pago_id}`;
    const t = sinTildes(String(m.texto || m.descripcion || ""));
    const nombres = conocidos.filter((n) => t.includes(n));
    return nombres.length === 1 ? `n:${nombres[0]}` : `m:${m.id}`;
  };
  const porQuien = (cs: MovMotor[]) => {
    const g = new Map<string, MovMotor[]>();
    for (const m of cs) g.set(quien(m), [...(g.get(quien(m)) || []), m]);
    return [...g.values()];
  };
  for (const l of libres()) {
    const objetivo = cent(Math.abs(l.importe));
    const sols: string[][] = [];
    for (const g of porQuien(candidatos(l))) {
      sols.push(...combinaciones(objetivo, g));
      if (sols.length > 1) break;
    }
    const compite = libres().some((o) => mismoImporte(o, l) && Math.abs(dias(o.fecha, l.fecha)) <= 10);
    if (sols.length === 1 && !compite) {
      cruzar(l, sols[0], sols[0].length > 1 ? `${sols[0].length} movimientos del mismo cliente, proveedor o persona suman exacto` : "Importe exacto");
      continue;
    }
    const que = l.vep ? "VEP" : l.importe > 0 ? "cobro" : "pago";
    decision(l, {
      estado: "sin_cruzar", clasificacion: l.vep ? "impuesto" : null, subtipo: l.vep ? "afip" : null,
      motivo: sols.length > 1 ? "Hay más de una combinación posible" : compite ? "Otra línea tiene el mismo importe"
        : exactos(l, false).length > exactos(l).length ? `Hay un ${que} del mismo importe, pero de otro CUIT: no se cruza solo`
        : combinaciones(objetivo, candidatos(l)).length ? "Varios movimientos suman exacto, pero son de clientes o proveedores distintos: no se cruzan solos"
        : l.vep ? "VEP sin cargar en Gastos" : l.importe > 0 ? "No está el cobro en el CRM" : "No está el pago en el CRM",
    });
  }
  return x.lineas.filter((l) => res.has(l.id)).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id.localeCompare(b.id)).map((l) => res.get(l.id)!);
}

/** Resumen de una corrida, para el cartel ("12 líneas: 9 del banco, 2 cruzadas, 1 sin cruzar"). */
export function resumenMotor(ds: DecisionBanco[]): { cruzadas: number; delBanco: number; sinCruzar: number } {
  return {
    cruzadas: ds.filter((d) => d.estado === "cruzada").length,
    delBanco: ds.filter((d) => d.estado === "del_banco").length,
    sinCruzar: ds.filter((d) => d.estado === "sin_cruzar").length,
  };
}
