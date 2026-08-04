/**
 * Professional PDF templates for all document types.
 * Generates print-ready HTML for Argentine business documents.
 *
 * Usage: each function returns an HTML string. Open in a new window and call print().
 */

import { formatCurrency, formatDate } from "@/lib/utils";

// ── Sociedad info (static data not in the Sociedad type) ─────────
interface SociedadPDF {
  nombre: string;
  razonSocial: string;
  cuit: string;
  condicionIva: string;
  colorPrimario: string;
  domicilio: string;
  telefono: string;
  email: string;
  web: string;
  inicioActividades: string;
  ingresosBrutos: string;
  jurisdiccion: string;
}

const SOCIEDAD_EXTRA: Record<string, Partial<SociedadPDF>> = {
  "eee2a3c8-fe6c-494d-bd2f-7a5d8067d021": {
    domicilio: "Pueyrredón 653, Pergamino, Buenos Aires",
    telefono: "2477 628958",
    email: "administracion@lazzari.com.ar",
    web: "http://www.lazzari.com.ar",
    inicioActividades: "01-09-2017",
    ingresosBrutos: "20379309128",
    jurisdiccion: "Buenos Aires",
  },
  "fee94607-747a-4e87-ba24-aff9032f7a56": {
    domicilio: "Pueyrredón 653, Pergamino, Buenos Aires",
    telefono: "2477 628958",
    email: "administracion@grupola.com.ar",
    web: "",
    inicioActividades: "01-01-2020",
    ingresosBrutos: "30719396042",
    jurisdiccion: "Buenos Aires",
  },
};

export function getSociedadPDF(sociedad: {
  id: string;
  nombre: string;
  razonSocial: string;
  cuit: string;
  condicionIva: string;
  colorPrimario: string;
}): SociedadPDF {
  const extra = SOCIEDAD_EXTRA[sociedad.id] || {};
  return {
    nombre: sociedad.nombre,
    razonSocial: sociedad.razonSocial,
    cuit: sociedad.cuit,
    condicionIva: sociedad.condicionIva || "Responsable Inscripto",
    colorPrimario: sociedad.colorPrimario || "#FF4500",
    domicilio: extra.domicilio || "",
    telefono: extra.telefono || "",
    email: extra.email || "",
    web: extra.web || "",
    inicioActividades: extra.inicioActividades || "",
    ingresosBrutos: extra.ingresosBrutos || "",
    jurisdiccion: extra.jurisdiccion || "",
  };
}

// ── Shared base styles ───────────────────────────────────────────
function baseStyles(color: string) {
  return `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #222; font-size: 12px; line-height: 1.45; background: #fff; }
    .page { max-width: 210mm; margin: 0 auto; padding: 12mm 15mm; }

    /* Header bar */
    .header-bar { background: ${color}; height: 6px; border-radius: 3px 3px 0 0; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; padding: 16px 0 14px; border-bottom: 2px solid #e0e0e0; margin-bottom: 18px; }
    .header-left {}
    .company-name { font-size: 20px; font-weight: 700; color: ${color}; letter-spacing: -0.3px; }
    .company-sub { font-size: 10px; color: #666; margin-top: 2px; }
    .company-detail { font-size: 9px; color: #888; margin-top: 1px; }
    .header-right { text-align: right; }
    .doc-title { font-size: 11px; text-transform: uppercase; letter-spacing: 2px; color: #666; font-weight: 700; }
    .doc-number { font-size: 22px; font-weight: 700; font-family: 'Courier New', Courier, monospace; color: #222; margin: 3px 0; }
    .doc-badge { display: inline-block; padding: 2px 14px; border-radius: 10px; font-size: 9px; font-weight: 700; background: #f0f0f0; color: #555; text-transform: uppercase; letter-spacing: 0.5px; }
    .doc-date { font-size: 10px; color: #888; margin-top: 5px; }

    /* Info boxes */
    .info-grid { display: flex; gap: 16px; margin-bottom: 18px; }
    .info-box { flex: 1; border: 1px solid #e0e0e0; border-radius: 6px; padding: 12px 14px; }
    .info-box-title { font-size: 8px; text-transform: uppercase; letter-spacing: 1.5px; color: ${color}; font-weight: 700; margin-bottom: 8px; padding-bottom: 4px; border-bottom: 1px solid #f0f0f0; }
    .info-row { margin-bottom: 4px; }
    .info-label { font-size: 8px; text-transform: uppercase; letter-spacing: 0.5px; color: #999; font-weight: 600; }
    .info-value { font-size: 11px; font-weight: 500; color: #333; }
    .info-value-lg { font-size: 13px; font-weight: 700; color: #222; }

    /* Items table */
    .items-title { font-size: 8px; text-transform: uppercase; letter-spacing: 1.5px; color: ${color}; font-weight: 700; margin-bottom: 10px; padding-bottom: 4px; border-bottom: 1px solid #f0f0f0; }
    table { width: 100%; border-collapse: collapse; }
    thead th { background: #f7f7f7; padding: 8px 10px; text-align: left; font-size: 8px; text-transform: uppercase; letter-spacing: 0.8px; color: #666; font-weight: 700; border-bottom: 2px solid #e0e0e0; }
    thead th.right { text-align: right; }
    thead th.center { text-align: center; }
    tbody td { padding: 7px 10px; font-size: 11px; border-bottom: 1px solid #f0f0f0; color: #333; }
    tbody tr:nth-child(even) td { background: #fafafa; }
    tbody tr:last-child td { border-bottom: 2px solid #e0e0e0; }
    .mono { font-family: 'Courier New', Courier, monospace; font-size: 10px; }
    .right { text-align: right; }
    .center { text-align: center; }
    .bold { font-weight: 700; }

    /* Totals */
    .totals-wrap { display: flex; justify-content: flex-end; margin-top: 14px; }
    .totals-box { width: 260px; }
    .total-row { display: flex; justify-content: space-between; align-items: center; padding: 5px 0; font-size: 11px; color: #555; }
    .total-row .mono { color: #222; }
    .total-row-final { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; margin-top: 4px; border-top: 2px solid #222; font-size: 15px; font-weight: 700; color: #222; }
    .total-row-final .mono { font-size: 14px; }

    /* Observations */
    .obs-block { background: #f9f9f9; border: 1px solid #e8e8e8; border-radius: 6px; padding: 12px 14px; margin-top: 18px; }
    .obs-title { font-size: 8px; text-transform: uppercase; letter-spacing: 1px; color: #999; font-weight: 700; margin-bottom: 5px; }
    .obs-text { font-size: 11px; color: #555; line-height: 1.5; white-space: pre-wrap; }

    /* Footer */
    .footer { margin-top: 36px; padding-top: 10px; border-top: 1px solid #e0e0e0; display: flex; justify-content: space-between; align-items: center; font-size: 8px; color: #bbb; }
    .footer-legal { text-align: center; font-size: 7px; color: #ccc; margin-top: 6px; }

    /* Signatures */
    .signatures { margin-top: 60px; display: flex; justify-content: space-between; }
    .sig-line { width: 180px; border-top: 1px solid #333; text-align: center; padding-top: 6px; font-size: 10px; color: #666; }

    /* Print */
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .page { padding: 8mm 12mm; max-width: none; }
      .header-bar { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      thead th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      tbody tr:nth-child(even) td { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
    @page { margin: 8mm; size: A4; }
  `;
}

// ── Factura-specific styles (ARCA layout) ────────────────────────
function facturaStyles(color: string) {
  return `
    ${baseStyles(color)}
    .fc-header { display: flex; border: 2px solid #333; margin-bottom: 16px; position: relative; }
    .fc-left { flex: 1; padding: 14px 16px; }
    .fc-right { flex: 1; padding: 14px 16px; }
    .fc-center { width: 56px; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; padding-top: 8px; border-left: 2px solid #333; border-right: 2px solid #333; background: #fafafa; }
    .fc-letra { font-size: 30px; font-weight: 900; color: #222; line-height: 1; }
    .fc-cod { font-size: 7px; color: #888; text-align: center; margin-top: 3px; font-weight: 600; }
    .emisor-name { font-size: 15px; font-weight: 700; color: #222; }
    .emisor-detail { font-size: 9px; color: #666; margin-top: 2px; }
    .comp-tipo { font-size: 12px; font-weight: 700; text-align: right; color: #222; }
    .comp-num { font-size: 16px; font-weight: 700; font-family: 'Courier New', Courier, monospace; text-align: right; margin-top: 4px; color: #222; }
    .comp-fecha { font-size: 10px; color: #666; text-align: right; margin-top: 6px; }

    /* CAE section */
    .cae-section { margin-top: 20px; padding: 14px 16px; border: 1px solid #e0e0e0; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; }
    .cae-label { font-size: 8px; text-transform: uppercase; letter-spacing: 1px; color: #888; font-weight: 700; }
    .cae-value { font-size: 15px; font-weight: 700; font-family: 'Courier New', Courier, monospace; margin-top: 2px; color: #222; }
    .cae-vto { font-size: 9px; color: #888; margin-top: 3px; }
    .qr-box { text-align: center; }
    .qr-box img { width: 100px; height: 100px; }
    .qr-text { font-size: 7px; color: #aaa; margin-top: 2px; }
  `;
}

// ────────────────────────────────────────────────────────────────
// PRESUPUESTO PDF
// ────────────────────────────────────────────────────────────────
interface PRItem {
  codigo: string;
  descripcion: string;
  cantidad: number;
  unidad: string;
  precioVenta: number;
  total: number;
}

interface PRData {
  numero: string;
  fecha: string;
  vencimiento: string;
  estado: string;
  estadoLabel: string;
  moneda: "ARS" | "USD";
  subtotal: number;
  iva: number;
  total: number;
  observaciones?: string;
  condicionPago?: string;
  creadoPor?: string;
  clienteNombre: string;
  clienteCuit?: string;
  clienteCondicionIva?: string;
  clienteEmail?: string;
  clienteTelefono?: string;
  clienteDireccion?: string;
  clienteLocalidad?: string;
  clienteProvincia?: string;
  vendedorNombre?: string;
  items: PRItem[];
}

export function generatePresupuestoPDF(
  pr: PRData,
  soc: SociedadPDF
): string {
  const c = soc.colorPrimario;
  const mon = pr.moneda;

  const itemRows = pr.items.map((it, i) => `
    <tr>
      <td class="center">${i + 1}</td>
      <td class="mono">${it.codigo || ""}</td>
      <td>${it.descripcion}</td>
      <td class="right">${it.cantidad}</td>
      <td class="center">${it.unidad || "u"}</td>
      <td class="right mono">${formatCurrency(it.precioVenta, mon)}</td>
      <td class="right mono bold">${formatCurrency(it.total, mon)}</td>
    </tr>`).join("");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${pr.numero} - ${soc.razonSocial}</title>
<style>${baseStyles(c)}</style></head><body>
<div class="page">
<div class="header-bar"></div>
<div class="header">
  <div class="header-left">
    <div class="company-name">${soc.nombre.toUpperCase()}</div>
    <div class="company-sub">${soc.razonSocial}</div>
    <div class="company-detail">CUIT: ${soc.cuit} | ${soc.condicionIva}</div>
    ${soc.domicilio ? `<div class="company-detail">${soc.domicilio}</div>` : ""}
    ${soc.telefono || soc.email ? `<div class="company-detail">${[soc.telefono, soc.email].filter(Boolean).join(" | ")}</div>` : ""}
  </div>
  <div class="header-right">
    <div class="doc-title">Presupuesto</div>
    <div class="doc-number">${pr.numero}</div>
    <div class="doc-badge">${pr.estadoLabel}</div>
    <div class="doc-date">${formatDate(pr.fecha)}${pr.vencimiento ? ` &mdash; Vence: ${formatDate(pr.vencimiento)}` : ""}</div>
  </div>
</div>

<div class="info-grid">
  <div class="info-box">
    <div class="info-box-title">Cliente</div>
    <div class="info-row"><div class="info-value-lg">${pr.clienteNombre}</div></div>
    ${pr.clienteCuit ? `<div class="info-row"><div class="info-label">CUIT</div><div class="info-value">${pr.clienteCuit}</div></div>` : ""}
    ${pr.clienteCondicionIva ? `<div class="info-row"><div class="info-label">Cond. IVA</div><div class="info-value">${pr.clienteCondicionIva}</div></div>` : ""}
    ${pr.clienteDireccion ? `<div class="info-row"><div class="info-label">Domicilio</div><div class="info-value">${pr.clienteDireccion}${pr.clienteLocalidad ? `, ${pr.clienteLocalidad}` : ""}${pr.clienteProvincia ? ` (${pr.clienteProvincia})` : ""}</div></div>` : ""}
  </div>
  <div class="info-box">
    <div class="info-box-title">Datos comerciales</div>
    ${pr.vendedorNombre ? `<div class="info-row"><div class="info-label">Vendedor</div><div class="info-value">${pr.vendedorNombre}</div></div>` : ""}
    ${pr.condicionPago ? `<div class="info-row"><div class="info-label">Cond. de pago</div><div class="info-value">${pr.condicionPago}</div></div>` : ""}
    <div class="info-row"><div class="info-label">Moneda</div><div class="info-value">${mon === "USD" ? "Dólares estadounidenses" : "Pesos argentinos"}</div></div>
    ${pr.clienteEmail ? `<div class="info-row"><div class="info-label">Email</div><div class="info-value">${pr.clienteEmail}</div></div>` : ""}
    ${pr.clienteTelefono ? `<div class="info-row"><div class="info-label">Teléfono</div><div class="info-value">${pr.clienteTelefono}</div></div>` : ""}
  </div>
</div>

<div class="items-title">Detalle de productos / servicios</div>
<table>
  <thead><tr>
    <th class="center" style="width:32px">#</th>
    <th style="width:90px">Código</th>
    <th>Descripción</th>
    <th class="right" style="width:55px">Cant.</th>
    <th class="center" style="width:50px">Unid.</th>
    <th class="right" style="width:95px">P. Unitario</th>
    <th class="right" style="width:95px">Total</th>
  </tr></thead>
  <tbody>${itemRows}</tbody>
</table>

<div class="totals-wrap">
  <div class="totals-box">
    <div class="total-row"><span>Subtotal</span><span class="mono">${formatCurrency(pr.subtotal, mon)}</span></div>
    <div class="total-row"><span>IVA</span><span class="mono">${formatCurrency(pr.iva, mon)}</span></div>
    <div class="total-row-final"><span>TOTAL (${mon})</span><span class="mono">${formatCurrency(pr.total, mon)}</span></div>
  </div>
</div>

${pr.observaciones ? `<div class="obs-block"><div class="obs-title">Observaciones</div><div class="obs-text">${pr.observaciones}</div></div>` : ""}

<div class="footer">
  <span>${soc.razonSocial} &mdash; CUIT ${soc.cuit}</span>
  <span>${pr.numero}${pr.creadoPor ? ` | ${pr.creadoPor}` : ""}</span>
  <span>Impreso: ${formatDate(new Date().toISOString())}</span>
</div>
<div class="footer-legal">Este presupuesto tiene validez hasta la fecha de vencimiento indicada. Los precios pueden estar sujetos a modificaciones.</div>

</div></body></html>`;
}

// ────────────────────────────────────────────────────────────────
// FACTURA PDF (ARCA layout with letra box)
// ────────────────────────────────────────────────────────────────
interface FacturaItemPDF {
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  iva_porcentaje: number;
  subtotal: number;
}

interface FacturaData {
  tipo: string;
  punto_venta: number;
  numero: number;
  fecha: string;
  fecha_vencimiento?: string | null;
  condicion_venta?: string | null;
  moneda: "ARS" | "USD";
  tipo_cambio?: number | null;
  subtotal: number;
  iva: number;
  total: number;
  cae?: string | null;
  cae_vencimiento?: string | null;
  oc_cliente?: string | null;
  cliente: {
    razon_social?: string;
    cuit?: string;
    condicion_iva?: string;
    direccion?: string;
    localidad?: string;
    provincia?: string;
    email?: string;
    telefono?: string;
  } | null;
  items: FacturaItemPDF[];
}

interface EmisorData {
  razonSocial: string;
  cuit: string;
  cuitNumero: number;
  condicionIva: string;
  domicilio: string;
  ptoVta: number;
}

export function generateFacturaPDF(
  f: FacturaData,
  emisor: EmisorData,
  soc: SociedadPDF
): string {
  const c = soc.colorPrimario;
  const cli = f.cliente;
  const letraComprobante = f.tipo.slice(-1);
  const isB = f.tipo === "FB" || f.tipo === "NCB" || f.tipo === "X" || f.tipo === "NDB" || f.tipo === "FCEB" || f.tipo === "NCEB";
  const isUSD = f.moneda === "USD" && f.tipo_cambio;

  const compNum = `${String(f.punto_venta).padStart(4, "0")}-${String(f.numero).padStart(8, "0")}`;

  const tipoLabel = f.tipo === "X" ? "FACTURA (INTERNA)"
    : f.tipo.startsWith("NCE") ? "NOTA DE CRÉDITO ELECTRÓNICA"
    : f.tipo.startsWith("NC") ? "NOTA DE CRÉDITO"
    : f.tipo.startsWith("NDE") ? "NOTA DE DÉBITO ELECTRÓNICA"
    : f.tipo.startsWith("ND") ? "NOTA DE DÉBITO"
    : f.tipo.startsWith("FCE") ? "FACTURA DE CRÉDITO ELECTRÓNICA"
    : "FACTURA";

  const codMap: Record<string, number> = { FA: 1, FB: 6, FC: 11, X: 0, NCA: 3, NCB: 8, NDA: 2, NDB: 7, FCEA: 201, FCEB: 206, NCEA: 203, NCEB: 208 };
  const codTipo = String(codMap[f.tipo] || 0).padStart(2, "0");

  // QR for ARCA verification
  const qrData = JSON.stringify({
    ver: 1, fecha: f.fecha, cuit: emisor.cuitNumero, ptoVta: f.punto_venta,
    tipoCmp: codMap[f.tipo] || 1,
    nroCmp: f.numero, importe: Number(f.total), moneda: isUSD ? "DOL" : "PES", ctz: isUSD ? Number(f.tipo_cambio) : 1,
    tipoDocRec: cli?.cuit ? 80 : 99, nroDocRec: cli?.cuit ? Number(cli.cuit.replace(/-/g, "")) : 0,
    tipoCodAut: "E", codAut: Number(f.cae || 0),
  });
  const qrBase64 = btoa(qrData);
  const qrUrl = `https://www.afip.gob.ar/fe/qr/?p=${qrBase64}`;

  const mon = f.moneda as "ARS" | "USD";

  const itemRows = f.items.length > 0 ? f.items.map((it, i) => `
    <tr>
      <td class="center">${i + 1}</td>
      <td>${it.descripcion}</td>
      <td class="right mono">${it.cantidad}</td>
      <td class="right mono">${formatCurrency(Number(it.precio_unitario), mon)}</td>
      ${isB ? "" : `<td class="right">${it.iva_porcentaje}%</td>`}
      <td class="right mono bold">${formatCurrency(Number(it.subtotal), mon)}</td>
    </tr>`).join("")
  : `<tr><td colspan="${isB ? 5 : 6}" style="text-align:center;color:#999;padding:20px;font-style:italic">Items detallados no disponibles</td></tr>`;

  const totalsHtml = isB
    ? `<div class="total-row"><span>Subtotal</span><span class="mono">${formatCurrency(Number(f.total), mon)}</span></div>
       <div class="total-row" style="color:#999;font-size:9px"><span>IVA incluido en precio</span><span class="mono">${formatCurrency(Number(f.iva), mon)}</span></div>
       <div class="total-row-final"><span>TOTAL</span><span class="mono">${formatCurrency(Number(f.total), mon)}</span></div>`
    : `<div class="total-row"><span>Neto gravado</span><span class="mono">${formatCurrency(Number(f.subtotal), mon)}</span></div>
       <div class="total-row"><span>IVA 21%</span><span class="mono">${formatCurrency(Number(f.iva), mon)}</span></div>
       <div class="total-row-final"><span>TOTAL</span><span class="mono">${formatCurrency(Number(f.total), mon)}</span></div>`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${tipoLabel} ${letraComprobante} ${compNum}</title>
<style>${facturaStyles(c)}</style></head><body>
<div class="page">

<div class="fc-header">
  <div class="fc-left">
    <div class="emisor-name">${emisor.razonSocial}</div>
    ${emisor.domicilio ? `<div class="emisor-detail">${emisor.domicilio}</div>` : ""}
    ${soc.email ? `<div class="emisor-detail">${soc.email}</div>` : ""}
    ${soc.web ? `<div class="emisor-detail">${soc.web}</div>` : ""}
    ${soc.telefono ? `<div class="emisor-detail">Teléfonos: ${soc.telefono}</div>` : ""}
  </div>
  <div class="fc-center">
    <div class="fc-letra">${letraComprobante}</div>
    <div class="fc-cod">COD. ${codTipo}</div>
  </div>
  <div class="fc-right">
    <div class="comp-tipo">${tipoLabel}</div>
    <div class="comp-sub">Original</div>
    <div class="comp-num">N° ${compNum}</div>
    <div class="comp-fecha">Fecha: ${formatDate(f.fecha)}</div>
    <div class="comp-fecha">C.U.I.T.: ${emisor.cuit}</div>
    ${soc.ingresosBrutos ? `<div class="comp-fecha">Ingresos brutos N°: ${soc.ingresosBrutos}</div>` : ""}
    ${soc.inicioActividades ? `<div class="comp-fecha">Inicio de actividad: ${soc.inicioActividades}</div>` : ""}
  </div>
</div>

<div class="info-grid">
  <div class="info-box">
    <div class="info-box-title">Datos del receptor</div>
    <div class="info-row"><div class="info-label">SR/ES</div><div class="info-value-lg">${cli?.razon_social || "\u2014"}${cli?.cuit ? ` <b>C.U.I.T.:</b> ${cli.cuit}` : ""}${cli?.condicion_iva ? ` - ${cli.condicion_iva === "RI" ? "Responsable inscripto" : cli.condicion_iva}` : ""}</div></div>
    ${cli?.direccion ? `<div class="info-row"><div class="info-label">Dirección</div><div class="info-value">${cli.direccion}${cli.localidad ? `, ${cli.localidad}` : ""}${cli.provincia ? `, ${cli.provincia}` : ""}</div></div>` : ""}
    ${cli?.email ? `<div class="info-row"><div class="info-label">Email</div><div class="info-value">${cli.email}</div></div>` : ""}
    ${cli?.telefono ? `<div class="info-row"><div class="info-label">Teléfono</div><div class="info-value">${cli.telefono}</div></div>` : ""}
  </div>
  <div class="info-box">
    <div class="info-box-title">Datos del comprobante</div>
    ${f.condicion_venta ? `<div class="info-row"><div class="info-label">Condición de venta</div><div class="info-value">${f.condicion_venta}</div></div>` : ""}
    ${soc.jurisdiccion ? `<div class="info-row"><div class="info-label">Jurisdicción</div><div class="info-value">${soc.jurisdiccion}</div></div>` : ""}
    ${f.fecha_vencimiento ? `<div class="info-row"><div class="info-label">Vencimiento</div><div class="info-value">${formatDate(f.fecha_vencimiento)}</div></div>` : ""}
    <div class="info-row"><div class="info-label">Moneda</div><div class="info-value">${mon === "USD" ? "DOLARES ESTADOUNIDENSES" : "PESOS ARGENTINOS"}</div></div>
    ${isUSD ? `<div class="info-row"><div class="info-label">Tipo de cambio</div><div class="info-value">$ ${Number(f.tipo_cambio).toLocaleString("es-AR", { minimumFractionDigits: 2 })}</div></div>` : ""}
    ${f.oc_cliente ? `<div class="info-row"><div class="info-label">OC Cliente</div><div class="info-value" style="color:${c};font-weight:700">${f.oc_cliente}</div></div>` : ""}
  </div>
</div>

<table>
  <thead><tr>
    <th class="center" style="width:32px">#</th>
    <th>Descripción</th>
    <th class="right" style="width:65px">Cantidad</th>
    <th class="right" style="width:95px">P. Unitario</th>
    ${isB ? "" : `<th class="right" style="width:55px">IVA %</th>`}
    <th class="right" style="width:95px">Subtotal</th>
  </tr></thead>
  <tbody>${itemRows}</tbody>
</table>

<div class="totals-wrap">
  <div class="totals-box">
    ${isUSD ? `<div class="total-row" style="color:#999;font-size:9px"><span>Operación en USD &mdash; TC: ${Number(f.tipo_cambio).toLocaleString("es-AR")}</span><span class="mono">USD ${(Number(f.total) / Number(f.tipo_cambio!)).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>` : ""}
    ${totalsHtml}
  </div>
</div>

${f.cae ? `
<div class="cae-section">
  <div>
    <div class="cae-label">CAE N°</div>
    <div class="cae-value">${f.cae}</div>
    ${f.cae_vencimiento ? `<div class="cae-vto">Fecha de vto. de CAE: ${formatDate(f.cae_vencimiento)}</div>` : ""}
  </div>
  <div class="qr-box">
    <img src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(qrUrl)}" alt="QR ARCA" />
    <div class="qr-text">Comprobante autorizado</div>
  </div>
</div>` : ""}

<div class="footer">
  <span>${emisor.razonSocial} &mdash; CUIT ${emisor.cuit}</span>
  <span>${tipoLabel} ${letraComprobante} N° ${compNum}</span>
  <span>Impreso: ${formatDate(new Date().toISOString())}</span>
</div>

</div></body></html>`;
}

// ────────────────────────────────────────────────────────────────
// REMITO PDF
// ────────────────────────────────────────────────────────────────
interface RemitoItemPDF {
  descripcion: string;
  cantidad: number;
  unidad: string | null;
}

interface TransportePDF {
  transportista: string;
  destino?: string | null;
  costo?: number | null;
  moneda?: string | null;
}

interface RemitoData {
  numero: string;
  fecha: string;
  cae?: string | null;
  oc_cliente?: string | null;
  valor_declarado?: number | null;
  observaciones?: string | null;
  cliente: {
    razon_social?: string;
    cuit?: string;
    condicion_iva?: string;
    direccion?: string;
    localidad?: string;
    provincia?: string;
  } | null;
  sucursal_nombre?: string | null;
  sucursal_direccion?: string | null;
  items: RemitoItemPDF[];
  transportes: TransportePDF[];
}

export function generateRemitoPDF(
  r: RemitoData,
  soc: SociedadPDF
): string {
  const c = soc.colorPrimario;
  const cli = r.cliente;

  const itemRows = r.items.length > 0
    ? r.items.map((it, i) => `
      <tr>
        <td class="center">${i + 1}</td>
        <td>${it.descripcion}</td>
        <td class="right bold">${it.cantidad}</td>
        <td class="center">${it.unidad || "u"}</td>
      </tr>`).join("")
    : `<tr><td colspan="4" style="text-align:center;color:#999;padding:24px;font-style:italic">Sin items</td></tr>`;

  // Delivery address logic
  const direccionEntrega = r.sucursal_nombre
    ? `${r.sucursal_nombre}${r.sucursal_direccion ? ` &mdash; ${r.sucursal_direccion}` : ""}`
    : (cli?.direccion ? `${cli.direccion}${cli.localidad ? `, ${cli.localidad}` : ""}${cli.provincia ? ` (${cli.provincia})` : ""}` : "");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Remito ${r.numero}</title>
<style>
  ${baseStyles(c)}
  .valor-declarado { background: #fff8e1; border: 2px solid #f9a825; border-radius: 6px; padding: 12px 16px; margin-top: 18px; font-size: 14px; font-weight: 700; color: #e65100; text-align: center; }
  .transport-grid { display: flex; flex-wrap: wrap; gap: 12px; }
  .transport-item { flex: 1; min-width: 140px; }
</style></head><body>
<div class="page">
<div class="header-bar"></div>
<div class="header">
  <div class="header-left">
    <div class="company-name">${soc.nombre.toUpperCase()}</div>
    <div class="company-sub">${soc.razonSocial}</div>
    <div class="company-detail">CUIT: ${soc.cuit} | ${soc.condicionIva}</div>
    ${soc.domicilio ? `<div class="company-detail">${soc.domicilio}</div>` : ""}
    ${soc.telefono || soc.email ? `<div class="company-detail">${[soc.telefono, soc.email].filter(Boolean).join(" | ")}</div>` : ""}
  </div>
  <div class="header-right">
    <div class="doc-title">Remito</div>
    <div class="doc-number">${r.numero}</div>
    <div class="doc-date">${formatDate(r.fecha)}</div>
    ${r.cae ? `<div class="doc-date" style="margin-top:3px">CAE: ${r.cae}</div>` : ""}
  </div>
</div>

<div class="info-grid">
  <div class="info-box">
    <div class="info-box-title">Destinatario</div>
    <div class="info-row"><div class="info-value-lg">${cli?.razon_social || "\u2014"}</div></div>
    ${cli?.cuit ? `<div class="info-row"><div class="info-label">CUIT</div><div class="info-value">${cli.cuit}</div></div>` : ""}
    ${cli?.condicion_iva ? `<div class="info-row"><div class="info-label">Cond. IVA</div><div class="info-value">${cli.condicion_iva}</div></div>` : ""}
    ${direccionEntrega ? `<div class="info-row"><div class="info-label">Dirección de entrega</div><div class="info-value">${direccionEntrega}</div></div>` : ""}
  </div>
  <div class="info-box">
    <div class="info-box-title">Datos del remito</div>
    ${r.oc_cliente ? `<div class="info-row"><div class="info-label">OC Cliente</div><div class="info-value" style="color:${c};font-weight:700;font-size:12px">${r.oc_cliente}</div></div>` : ""}
    ${r.transportes.length > 0 ? r.transportes.map(t => `
      <div class="info-row"><div class="info-label">Transportista</div><div class="info-value">${t.transportista}</div></div>
      ${t.destino ? `<div class="info-row"><div class="info-label">Destino</div><div class="info-value">${t.destino}</div></div>` : ""}
      ${t.costo ? `<div class="info-row"><div class="info-label">Costo flete</div><div class="info-value">${formatCurrency(Number(t.costo), (t.moneda || "ARS") as "USD" | "ARS")}</div></div>` : ""}
    `).join("") : `<div class="info-row"><div class="info-value" style="color:#999;font-style:italic">Sin transporte asignado</div></div>`}
  </div>
</div>

<div class="items-title">Detalle de mercadería</div>
<table>
  <thead><tr>
    <th class="center" style="width:36px">#</th>
    <th>Descripción</th>
    <th class="right" style="width:80px">Cantidad</th>
    <th class="center" style="width:65px">Unidad</th>
  </tr></thead>
  <tbody>${itemRows}</tbody>
</table>

${r.valor_declarado ? `<div class="valor-declarado">VALOR DECLARADO: $ ${Number(r.valor_declarado).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>` : ""}

${r.observaciones ? `<div class="obs-block"><div class="obs-title">Observaciones</div><div class="obs-text">${r.observaciones}</div></div>` : ""}

<div class="signatures">
  <div class="sig-line">Firma y aclaración del emisor</div>
  <div class="sig-line">Firma y aclaración del receptor</div>
</div>

<div class="footer">
  <span>${soc.razonSocial} &mdash; CUIT ${soc.cuit}</span>
  <span>${r.numero}</span>
  <span>Impreso: ${formatDate(new Date().toISOString())}</span>
</div>
<div class="footer-legal">Duplicado &mdash; Recibí conforme la mercadería detallada precedentemente.</div>

</div></body></html>`;
}

// ────────────────────────────────────────────────────────────────
// ORDEN DE COMPRA PDF
// ────────────────────────────────────────────────────────────────
interface OCItemPDF {
  codigo: string;
  descripcion: string;
  cantidad: number;
  unidad?: string | null;
  precio_unitario: number;
  subtotal: number;
}

interface OCData {
  numero: string;
  fecha: string;
  fecha_entrega_estimada?: string | null;
  estado: string;
  estadoLabel: string;
  moneda: "ARS" | "USD";
  subtotal: number;
  iva: number;
  total: number;
  observaciones?: string | null;
  presupuesto_origen?: { numero: string } | null;
  proveedor: {
    razon_social?: string | null;
    cuit?: string | null;
    condicion_iva?: string | null;
    direccion?: string | null;
    localidad?: string | null;
    provincia?: string | null;
    email?: string | null;
    telefono?: string | null;
    forma_pago?: string | null;
  } | null;
  items: OCItemPDF[];
}

export function generateOrdenCompraPDF(
  oc: OCData,
  soc: SociedadPDF
): string {
  const c = soc.colorPrimario;
  const mon = oc.moneda;
  const prov = oc.proveedor;

  const itemRows = oc.items.map((it, i) => `
    <tr>
      <td class="center">${i + 1}</td>
      <td class="mono">${it.codigo || ""}</td>
      <td>${it.descripcion}</td>
      <td class="right">${it.cantidad}</td>
      <td class="center">${it.unidad || "u"}</td>
      <td class="right mono">${formatCurrency(Number(it.precio_unitario), mon)}</td>
      <td class="right mono bold">${formatCurrency(Number(it.subtotal), mon)}</td>
    </tr>`).join("");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${oc.numero} - ${soc.razonSocial}</title>
<style>${baseStyles(c)}</style></head><body>
<div class="page">
<div class="header-bar"></div>
<div class="header">
  <div class="header-left">
    <div class="company-name">${soc.nombre.toUpperCase()}</div>
    <div class="company-sub">${soc.razonSocial}</div>
    <div class="company-detail">CUIT: ${soc.cuit} | ${soc.condicionIva}</div>
    ${soc.domicilio ? `<div class="company-detail">${soc.domicilio}</div>` : ""}
    ${soc.telefono || soc.email ? `<div class="company-detail">${[soc.telefono, soc.email].filter(Boolean).join(" | ")}</div>` : ""}
  </div>
  <div class="header-right">
    <div class="doc-title">Orden de Compra</div>
    <div class="doc-number">${oc.numero}</div>
    <div class="doc-badge">${oc.estadoLabel}</div>
    <div class="doc-date">${formatDate(oc.fecha)}${oc.fecha_entrega_estimada ? ` &mdash; Entrega: ${formatDate(oc.fecha_entrega_estimada)}` : ""}</div>
  </div>
</div>

<div class="info-grid">
  <div class="info-box">
    <div class="info-box-title">Proveedor</div>
    <div class="info-row"><div class="info-value-lg">${prov?.razon_social || "\u2014"}</div></div>
    ${prov?.cuit ? `<div class="info-row"><div class="info-label">CUIT</div><div class="info-value">${prov.cuit}</div></div>` : ""}
    ${prov?.condicion_iva ? `<div class="info-row"><div class="info-label">Cond. IVA</div><div class="info-value">${prov.condicion_iva}</div></div>` : ""}
    ${prov?.direccion ? `<div class="info-row"><div class="info-label">Domicilio</div><div class="info-value">${prov.direccion}${prov.localidad ? `, ${prov.localidad}` : ""}${prov.provincia ? ` (${prov.provincia})` : ""}</div></div>` : ""}
  </div>
  <div class="info-box">
    <div class="info-box-title">Datos de la orden</div>
    ${prov?.forma_pago ? `<div class="info-row"><div class="info-label">Forma de pago</div><div class="info-value">${prov.forma_pago}</div></div>` : ""}
    <div class="info-row"><div class="info-label">Moneda</div><div class="info-value">${mon === "USD" ? "Dólares estadounidenses" : "Pesos argentinos"}</div></div>
    ${prov?.email ? `<div class="info-row"><div class="info-label">Email</div><div class="info-value">${prov.email}</div></div>` : ""}
    ${prov?.telefono ? `<div class="info-row"><div class="info-label">Teléfono</div><div class="info-value">${prov.telefono}</div></div>` : ""}
    ${oc.presupuesto_origen ? `<div class="info-row"><div class="info-label">PR Origen</div><div class="info-value" style="color:${c};font-weight:700">${oc.presupuesto_origen.numero}</div></div>` : ""}
  </div>
</div>

<div class="items-title">Detalle de productos / servicios</div>
<table>
  <thead><tr>
    <th class="center" style="width:32px">#</th>
    <th style="width:90px">Código</th>
    <th>Descripción</th>
    <th class="right" style="width:55px">Cant.</th>
    <th class="center" style="width:50px">Unid.</th>
    <th class="right" style="width:95px">P. Unitario</th>
    <th class="right" style="width:95px">Subtotal</th>
  </tr></thead>
  <tbody>${itemRows}</tbody>
</table>

<div class="totals-wrap">
  <div class="totals-box">
    <div class="total-row"><span>Subtotal</span><span class="mono">${formatCurrency(Number(oc.subtotal), mon)}</span></div>
    <div class="total-row"><span>IVA</span><span class="mono">${formatCurrency(Number(oc.iva), mon)}</span></div>
    <div class="total-row-final"><span>TOTAL (${mon})</span><span class="mono">${formatCurrency(Number(oc.total), mon)}</span></div>
  </div>
</div>

${oc.observaciones ? `<div class="obs-block"><div class="obs-title">Observaciones</div><div class="obs-text">${oc.observaciones}</div></div>` : ""}

<div class="footer">
  <span>${soc.razonSocial} &mdash; CUIT ${soc.cuit}</span>
  <span>${oc.numero}${oc.presupuesto_origen ? ` | PR: ${oc.presupuesto_origen.numero}` : ""}</span>
  <span>Impreso: ${formatDate(new Date().toISOString())}</span>
</div>
<div class="footer-legal">Documento interno &mdash; Orden de compra emitida por ${soc.razonSocial}.</div>

</div></body></html>`;
}

// ── Helper to open PDF in new window ─────────────────────────────
export function openPDFWindow(html: string) {
  const w = window.open("", "_blank");
  if (w) {
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 600);
  }
}
