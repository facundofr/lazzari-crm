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

// Logo Lazzari 150px (base64 embedded for offline PDF printing)
const LAZZARI_LOGO_B64 = "data:image/png;base64," + "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";

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
    <img src="${LAZZARI_LOGO_B64}" alt="${soc.nombre}" style="height:40px;margin-bottom:4px" />
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
    <img src="${LAZZARI_LOGO_B64}" alt="${soc.nombre}" style="height:48px;margin-bottom:6px" />
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
    <img src="${LAZZARI_LOGO_B64}" alt="${soc.nombre}" style="height:40px;margin-bottom:4px" />
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
    <img src="${LAZZARI_LOGO_B64}" alt="${soc.nombre}" style="height:40px;margin-bottom:4px" />
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
