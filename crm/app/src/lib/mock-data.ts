import type {
  User, Client, Product, Presupuesto, Factura, Remito, Movimiento, ActivityLog, Alert,
  Proveedor, ListaPrecios, OrdenCompra, ExtractoBancario, LineaCredito,
} from "./types";

// ── Usuarios ─────────────────────────────────────────────────────
export const mockUsers: User[] = [
  { id: "u1", name: "Martín Lazzari", email: "martin@lazzari.com.ar", role: "admin", active: true, createdAt: "2026-01-15" },
  { id: "u2", name: "Carolina Ruiz", email: "carolina@lazzari.com.ar", role: "vendedor", active: true, createdAt: "2026-02-01" },
  { id: "u3", name: "Pablo Fernández", email: "pablo@lazzari.com.ar", role: "administrativo", active: true, createdAt: "2026-02-10" },
  { id: "u4", name: "Lucía Gómez", email: "lucia@lazzari.com.ar", role: "vendedor", active: true, createdAt: "2026-03-01" },
  { id: "u5", name: "Diego Morales", email: "diego@lazzari.com.ar", role: "viewer", active: false, createdAt: "2026-03-15" },
];

// ── Clientes ─────────────────────────────────────────────────────
export const mockClients: Client[] = [
  {
    id: "c1", type: "empresa", razonSocial: "Metalúrgica San Martín S.A.", cuit: "30-71234567-8",
    condicionIva: "RI", email: "compras@metalurgicasm.com.ar", telefono: "011-4555-1234",
    direccion: "Av. Industria 1450", localidad: "San Martín", provincia: "Buenos Aires", cp: "1650",
    sucursales: [{ id: "s1", nombre: "Planta 2", direccion: "Ruta 8 km 34", localidad: "Pilar", provincia: "Buenos Aires", telefono: "0230-444-5678" }],
    contactos: [{ id: "ct1", nombre: "Ricardo Méndez", cargo: "Jefe de Compras", email: "rmendez@metalurgicasm.com.ar", telefono: "11-5555-0001", principal: true }],
    listaPrecio: "Industrial A", diasCuentaCorriente: 30, formaPago: "Cheque 30 días",
    limiteCredito: 5000000, saldoCuentaCorriente: 1250000, notas: "Cliente desde 2019. Compra mensual regular.",
    activo: true, createdAt: "2024-03-10", updatedAt: "2026-05-15", assignedTo: "u2",
  },
  {
    id: "c2", type: "empresa", razonSocial: "Constructora Patagonia SRL", cuit: "30-70987654-3",
    condicionIva: "RI", email: "info@constructorapatagonia.com.ar", telefono: "0299-442-3456",
    direccion: "Calle Belgrano 320", localidad: "Neuquén", provincia: "Neuquén", cp: "8300",
    sucursales: [], contactos: [{ id: "ct2", nombre: "Ana López", cargo: "Gerente", email: "alopez@cpatagonia.com.ar", telefono: "299-555-0002", principal: true }],
    listaPrecio: "Distribución", diasCuentaCorriente: 60, formaPago: "Transferencia",
    limiteCredito: 8000000, saldoCuentaCorriente: 3200000, notas: "Grandes volúmenes. Requiere logística especial.",
    activo: true, createdAt: "2024-06-20", updatedAt: "2026-05-10", assignedTo: "u4",
  },
  {
    id: "c3", type: "empresa", razonSocial: "Agro Insumos del Litoral S.A.", cuit: "30-71567890-1",
    condicionIva: "RI", email: "compras@agrolitoral.com.ar", telefono: "0342-456-7890",
    direccion: "Ruta 11 km 482", localidad: "Santa Fe", provincia: "Santa Fe", cp: "3000",
    sucursales: [], contactos: [{ id: "ct3", nombre: "Marcos Gutiérrez", cargo: "Compras", email: "marcos@agrolitoral.com.ar", telefono: "342-555-0003", principal: true }],
    listaPrecio: "Industrial B", diasCuentaCorriente: 30, formaPago: "E-cheque",
    limiteCredito: 3000000, saldoCuentaCorriente: 780000, notas: "",
    activo: true, createdAt: "2025-01-10", updatedAt: "2026-04-28", assignedTo: "u2",
  },
  {
    id: "c4", type: "empresa", razonSocial: "Minera Andina S.A.", cuit: "30-70345678-9",
    condicionIva: "RI", email: "logistica@mineraandina.com.ar", telefono: "0264-421-0987",
    direccion: "Av. Libertador 890", localidad: "San Juan", provincia: "San Juan", cp: "5400",
    sucursales: [{ id: "s2", nombre: "Mina Veladero", direccion: "Ruta 150 km 320", localidad: "Iglesia", provincia: "San Juan", telefono: "264-555-9876" }],
    contactos: [{ id: "ct4", nombre: "Fernando Acosta", cargo: "Supply Chain", email: "facosta@mineraandina.com.ar", telefono: "264-555-0004", principal: true }],
    listaPrecio: "Minería", diasCuentaCorriente: 45, formaPago: "Transferencia",
    limiteCredito: 15000000, saldoCuentaCorriente: 6500000, notas: "Pedidos grandes con entrega en mina.",
    activo: true, createdAt: "2023-11-05", updatedAt: "2026-05-18", assignedTo: "u4",
  },
  {
    id: "c5", type: "empresa", razonSocial: "Petroquímica del Sur S.A.", cuit: "30-71890123-4",
    condicionIva: "RI", email: "compras@petrosur.com.ar", telefono: "0291-453-2100",
    direccion: "Polo Petroquímico", localidad: "Bahía Blanca", provincia: "Buenos Aires", cp: "8000",
    sucursales: [], contactos: [{ id: "ct5", nombre: "Silvia Martínez", cargo: "Compras", email: "smartinez@petrosur.com.ar", telefono: "291-555-0005", principal: true }],
    listaPrecio: "Industrial A", diasCuentaCorriente: 30, formaPago: "Cheque 30 días",
    limiteCredito: 10000000, saldoCuentaCorriente: 2100000, notas: "Requiere certificaciones de calidad.",
    activo: true, createdAt: "2024-08-15", updatedAt: "2026-05-12", assignedTo: "u2",
  },
];

// ── Productos ────────────────────────────────────────────────────
export const mockProducts: Product[] = [
  { id: "p1", codigo: "VAL-001", nombre: "Válvula esférica 2\" AISI 316", categoria: "Válvulas", proveedor: "Giacomini", precioCosto: 45200, monedaCosto: "ARS", unidad: "u", iva: 21, stock: 34, stockMinimo: 10, activo: true, updatedAt: "2026-05-10" },
  { id: "p2", codigo: "CAÑ-015", nombre: "Caño acero SCH40 4\" x 6m", categoria: "Caños", proveedor: "Tenaris", precioCosto: 128500, monedaCosto: "ARS", unidad: "u", iva: 21, stock: 12, stockMinimo: 5, activo: true, updatedAt: "2026-05-08" },
  { id: "p3", codigo: "BRI-008", nombre: "Brida slip-on 6\" 150#", categoria: "Bridas", proveedor: "Duo Matic", precioCosto: 67800, monedaCosto: "ARS", unidad: "u", iva: 21, stock: 22, stockMinimo: 8, activo: true, updatedAt: "2026-05-12" },
  { id: "p4", codigo: "FIT-022", nombre: "Codo 90° 2\" SCH40 SW", categoria: "Fittings", proveedor: "Duo Matic", precioCosto: 18900, monedaCosto: "ARS", unidad: "u", iva: 21, stock: 56, stockMinimo: 20, activo: true, updatedAt: "2026-05-14" },
  { id: "p5", codigo: "JUN-003", nombre: "Junta espirometálica 4\" 150#", categoria: "Juntas", proveedor: "Flexitallic", precioCosto: 12400, monedaCosto: "ARS", unidad: "u", iva: 21, stock: 3, stockMinimo: 15, activo: true, updatedAt: "2026-05-01" },
  { id: "p6", codigo: "BUL-010", nombre: "Bulón hexagonal M16x80 8.8 ZN", categoria: "Bulonería", proveedor: "Bulmax", precioCosto: 1250, monedaCosto: "ARS", unidad: "u", iva: 21, stock: 500, stockMinimo: 100, activo: true, updatedAt: "2026-05-13" },
  { id: "p7", codigo: "INS-005", nombre: "Manómetro glicerina 0-10 bar 4\"", categoria: "Instrumentación", proveedor: "WIKA", precioCosto: 35600, monedaCosto: "ARS", unidad: "u", iva: 21, stock: 8, stockMinimo: 3, activo: true, updatedAt: "2026-05-09" },
  { id: "p8", codigo: "BOM-002", nombre: "Bomba centrífuga 5HP trifásica", categoria: "Bombas", proveedor: "Pedrollo", precioCosto: 890000, monedaCosto: "ARS", unidad: "u", iva: 21, stock: 2, stockMinimo: 1, activo: true, updatedAt: "2026-04-28" },
];

// ── Presupuestos ─────────────────────────────────────────────────
export const mockPresupuestos: Presupuesto[] = [
  {
    id: "pr1", numero: "PR-2026-0047", clienteId: "c1", clienteNombre: "Metalúrgica San Martín S.A.",
    fecha: "2026-05-15", vencimiento: "2026-05-30", estado: "pendiente", markupGeneral: 35,
    items: [
      { id: "i1", productoId: "p1", codigo: "VAL-001", descripcion: "Válvula esférica 2\" AISI 316", categoria: "Válvulas", cantidad: 10, unidad: "u", precioCosto: 45200, markupPorcentaje: 35, precioVenta: 61020, subtotal: 610200, iva: 128142, total: 738342 },
      { id: "i2", productoId: "p4", codigo: "FIT-022", descripcion: "Codo 90° 2\" SCH40 SW", categoria: "Fittings", cantidad: 20, unidad: "u", precioCosto: 18900, markupPorcentaje: 35, precioVenta: 25515, subtotal: 510300, iva: 107163, total: 617463 },
    ],
    subtotal: 1120500, iva: 235305, total: 1355805, moneda: "ARS",
    observaciones: "Entrega en planta San Martín", creadoPor: "u2", enviadoAt: "2026-05-15",
    createdAt: "2026-05-15", updatedAt: "2026-05-15",
  },
  {
    id: "pr2", numero: "PR-2026-0048", clienteId: "c4", clienteNombre: "Minera Andina S.A.",
    fecha: "2026-05-16", vencimiento: "2026-06-15", estado: "aprobado", markupGeneral: 40,
    items: [
      { id: "i3", productoId: "p2", codigo: "CAÑ-015", descripcion: "Caño acero SCH40 4\" x 6m", categoria: "Caños", cantidad: 30, unidad: "u", precioCosto: 128500, markupPorcentaje: 40, precioVenta: 179900, subtotal: 5397000, iva: 1133370, total: 6530370 },
      { id: "i4", productoId: "p3", codigo: "BRI-008", descripcion: "Brida slip-on 6\" 150#", categoria: "Bridas", cantidad: 60, unidad: "u", precioCosto: 67800, markupPorcentaje: 40, precioVenta: 94920, subtotal: 5695200, iva: 1195992, total: 6891192 },
      { id: "i5", productoId: "p5", codigo: "JUN-003", descripcion: "Junta espirometálica 4\" 150#", categoria: "Juntas", cantidad: 60, unidad: "u", precioCosto: 12400, markupPorcentaje: 45, precioVenta: 17980, subtotal: 1078800, iva: 226548, total: 1305348 },
    ],
    subtotal: 12171000, iva: 2555910, total: 14726910, moneda: "ARS",
    observaciones: "Entrega en Mina Veladero. Requiere remito con CAE.", creadoPor: "u4", enviadoAt: "2026-05-16", respondidoAt: "2026-05-18",
    createdAt: "2026-05-16", updatedAt: "2026-05-18",
  },
  {
    id: "pr3", numero: "PR-2026-0045", clienteId: "c2", clienteNombre: "Constructora Patagonia SRL",
    fecha: "2026-05-10", vencimiento: "2026-05-25", estado: "rechazado", motivoRechazo: "Precio fuera de presupuesto. Pidieron 20% menos.",
    markupGeneral: 38,
    items: [
      { id: "i6", productoId: "p8", codigo: "BOM-002", descripcion: "Bomba centrífuga 5HP trifásica", categoria: "Bombas", cantidad: 3, unidad: "u", precioCosto: 890000, markupPorcentaje: 38, precioVenta: 1228200, subtotal: 3684600, iva: 773766, total: 4458366 },
    ],
    subtotal: 3684600, iva: 773766, total: 4458366, moneda: "ARS",
    observaciones: "", creadoPor: "u2", enviadoAt: "2026-05-10", respondidoAt: "2026-05-14",
    createdAt: "2026-05-10", updatedAt: "2026-05-14",
  },
  {
    id: "pr4", numero: "PR-2026-0046", clienteId: "c3", clienteNombre: "Agro Insumos del Litoral S.A.",
    fecha: "2026-05-12", vencimiento: "2026-05-27", estado: "postergado",
    markupGeneral: 30,
    items: [
      { id: "i7", productoId: "p7", codigo: "INS-005", descripcion: "Manómetro glicerina 0-10 bar 4\"", categoria: "Instrumentación", cantidad: 15, unidad: "u", precioCosto: 35600, markupPorcentaje: 30, precioVenta: 46280, subtotal: 694200, iva: 145782, total: 839982 },
      { id: "i8", productoId: "p6", codigo: "BUL-010", descripcion: "Bulón hexagonal M16x80 8.8 ZN", categoria: "Bulonería", cantidad: 200, unidad: "u", precioCosto: 1250, markupPorcentaje: 30, precioVenta: 1625, subtotal: 325000, iva: 68250, total: 393250 },
    ],
    subtotal: 1019200, iva: 214032, total: 1233232, moneda: "ARS",
    observaciones: "Cliente postergó para junio", creadoPor: "u2",
    createdAt: "2026-05-12", updatedAt: "2026-05-19",
  },
  {
    id: "pr5", numero: "PR-2026-0049", clienteId: "c5", clienteNombre: "Petroquímica del Sur S.A.",
    fecha: "2026-05-19", vencimiento: "2026-06-03", estado: "borrador", markupGeneral: 35,
    items: [
      { id: "i9", productoId: "p1", codigo: "VAL-001", descripcion: "Válvula esférica 2\" AISI 316", categoria: "Válvulas", cantidad: 25, unidad: "u", precioCosto: 45200, markupPorcentaje: 35, precioVenta: 61020, subtotal: 1525500, iva: 320355, total: 1845855 },
    ],
    subtotal: 1525500, iva: 320355, total: 1845855, moneda: "ARS",
    observaciones: "Borrador - pendiente agregar más items", creadoPor: "u4",
    createdAt: "2026-05-19", updatedAt: "2026-05-19",
  },
];

// ── Facturas ─────────────────────────────────────────────────────
export const mockFacturas: Factura[] = [
  {
    id: "f1", tipo: "FA", puntoVenta: 1, numero: 234, clienteId: "c4", clienteNombre: "Minera Andina S.A.",
    presupuestoId: "pr2", fecha: "2026-05-18", cae: "74123456789012", caeVencimiento: "2026-05-28",
    items: [
      { id: "fi1", descripcion: "Caño acero SCH40 4\" x 6m", cantidad: 30, precioUnitario: 179900, iva: 21, subtotal: 5397000 },
      { id: "fi2", descripcion: "Brida slip-on 6\" 150#", cantidad: 60, precioUnitario: 94920, iva: 21, subtotal: 5695200 },
      { id: "fi3", descripcion: "Junta espirometálica 4\" 150#", cantidad: 60, precioUnitario: 17980, iva: 21, subtotal: 1078800 },
    ],
    subtotal: 12171000, iva: 2555910, total: 14726910, estado: "emitida", createdAt: "2026-05-18",
  },
];

// ── Remitos ──────────────────────────────────────────────────────
export const mockRemitos: Remito[] = [
  {
    id: "r1", numero: "R-2026-0012", clienteId: "c4", clienteNombre: "Minera Andina S.A.",
    presupuestoId: "pr2", fecha: "2026-05-19", cae: "74123456789013",
    items: [
      { id: "ri1", productoId: "p2", descripcion: "Caño acero SCH40 4\" x 6m", cantidad: 30, unidad: "u" },
      { id: "ri2", productoId: "p3", descripcion: "Brida slip-on 6\" 150#", cantidad: 60, unidad: "u" },
    ],
    estado: "pendiente", observaciones: "Entrega en Mina Veladero - coordinar con logística", createdAt: "2026-05-19",
  },
];

// ── Movimientos financieros ──────────────────────────────────────
export const mockMovimientos: Movimiento[] = [
  { id: "m1", tipo: "cobro", clienteId: "c1", descripcion: "Cobro parcial FC A-0001-00230", monto: 800000, fecha: "2026-05-14", conciliado: true, createdAt: "2026-05-14" },
  { id: "m2", tipo: "cheque_recibido", clienteId: "c3", descripcion: "E-cheque #45678 a 30 días", monto: 500000, fecha: "2026-05-10", conciliado: false, createdAt: "2026-05-10" },
  { id: "m3", tipo: "pago", proveedorId: "prov1", descripcion: "Pago a Giacomini - FC compra", monto: 1520000, fecha: "2026-05-12", conciliado: true, createdAt: "2026-05-12" },
  { id: "m4", tipo: "transferencia", clienteId: "c2", descripcion: "Transferencia Constructora Patagonia", monto: 2000000, fecha: "2026-05-16", conciliado: true, createdAt: "2026-05-16" },
  { id: "m5", tipo: "cheque_emitido", proveedorId: "prov2", descripcion: "Cheque a Tenaris - vto 15/06", monto: 3855000, fecha: "2026-05-18", conciliado: false, createdAt: "2026-05-18" },
];

// ── Actividad reciente ───────────────────────────────────────────
export const mockActivity: ActivityLog[] = [
  { id: "a1", userId: "u4", userName: "Lucía Gómez", action: "create", module: "presupuestos", entityId: "pr5", details: "Creó borrador PR-2026-0049 para Petroquímica del Sur", createdAt: "2026-05-19T10:30:00" },
  { id: "a2", userId: "u2", userName: "Carolina Ruiz", action: "update", module: "presupuestos", entityId: "pr2", details: "Marcó PR-2026-0048 como aprobado", createdAt: "2026-05-18T16:45:00" },
  { id: "a3", userId: "u3", userName: "Pablo Fernández", action: "create", module: "facturacion", entityId: "f1", details: "Emitió FA A-0001-00234 para Minera Andina por $14.726.910", createdAt: "2026-05-18T17:00:00" },
  { id: "a4", userId: "u2", userName: "Carolina Ruiz", action: "update", module: "presupuestos", entityId: "pr3", details: "PR-2026-0045 rechazado: precio fuera de presupuesto", createdAt: "2026-05-14T11:20:00" },
  { id: "a5", userId: "u3", userName: "Pablo Fernández", action: "create", module: "finanzas", entityId: "m4", details: "Registró cobro por transferencia de Constructora Patagonia: $2.000.000", createdAt: "2026-05-16T09:15:00" },
  { id: "a6", userId: "u1", userName: "Martín Lazzari", action: "update", module: "clientes", entityId: "c4", details: "Actualizó límite de crédito de Minera Andina a $15.000.000", createdAt: "2026-05-15T14:00:00" },
];

// ── Alertas ──────────────────────────────────────────────────────
export const mockAlerts: Alert[] = [
  { id: "al1", type: "stock_bajo", title: "Stock bajo: Juntas espirometálicas", description: "Solo quedan 3 unidades (mínimo: 15)", entityId: "p5", module: "stock", read: false, createdAt: "2026-05-19T08:00:00" },
  { id: "al2", type: "vencimiento_pr", title: "PR-2026-0047 vence en 11 días", description: "Metalúrgica San Martín - $1.355.805 pendiente de respuesta", entityId: "pr1", module: "presupuestos", read: false, createdAt: "2026-05-19T08:00:00" },
  { id: "al3", type: "cheque_proximo", title: "E-cheque a depositar", description: "Cheque #45678 de Agro Insumos - $500.000 - vence en 10 días", entityId: "m2", module: "finanzas", read: false, createdAt: "2026-05-19T08:00:00" },
  { id: "al4", type: "seguimiento", title: "Seguimiento: Constructora Patagonia", description: "PR rechazado hace 5 días por precio. Evaluar re-cotización con markup menor.", entityId: "pr3", module: "presupuestos", read: true, createdAt: "2026-05-19T08:00:00" },
  { id: "al5", type: "cc_vencida", title: "Cuenta corriente próxima a vencer", description: "Metalúrgica San Martín - saldo $1.250.000 - 30 días CC", entityId: "c1", module: "finanzas", read: false, createdAt: "2026-05-19T08:00:00" },
];

// ── Proveedores ──────────────────────────────────────────────────
export const mockProveedores: Proveedor[] = [
  {
    id: "prov1", razonSocial: "Giacomini Argentina S.A.", cuit: "30-60123456-7",
    condicionIva: "RI", email: "ventas@giacomini.com.ar", telefono: "011-4321-5678",
    direccion: "Av. del Libertador 6250", localidad: "CABA", provincia: "Buenos Aires",
    contactos: [{ id: "pct1", nombre: "Laura Pereyra", cargo: "Ejecutiva de cuentas", email: "lpereyra@giacomini.com.ar", telefono: "11-6666-0001", principal: true }],
    rubro: "Válvulas y grifería industrial", formaPago: "Cheque 60 días", diasCuentaCorriente: 60,
    limiteCredito: 8000000, saldoCuentaCorriente: 2350000,
    listasDePrecios: ["lp1"], notas: "Proveedor principal de válvulas. Descuento especial > 50 unidades.",
    clasificacionTags: ["Buen precio", "Buena calidad"], marcas: "Giacomini", clasificacionNota: "Excelente relacion precio-calidad en válvulas",
    activo: true, createdAt: "2023-01-15", updatedAt: "2026-05-10",
  },
  {
    id: "prov2", razonSocial: "Tenaris S.A.", cuit: "30-50987654-1",
    condicionIva: "RI", email: "pedidos@tenaris.com", telefono: "011-4018-2100",
    direccion: "Carlos Della Paolera 299", localidad: "CABA", provincia: "Buenos Aires",
    contactos: [{ id: "pct2", nombre: "Gabriel Torres", cargo: "KAM Industrial", email: "gtorres@tenaris.com", telefono: "11-6666-0002", principal: true }],
    rubro: "Tubos de acero y conexiones", formaPago: "Transferencia 30 días", diasCuentaCorriente: 30,
    limiteCredito: 20000000, saldoCuentaCorriente: 7800000,
    listasDePrecios: ["lp2"], notas: "Pedido mínimo 10 unidades. Entrega desde planta Campana.",
    clasificacionTags: ["Precio alto", "Buena calidad", "Stock permanente"], marcas: "Tenaris, Siderca", clasificacionNota: "",
    activo: true, createdAt: "2022-06-01", updatedAt: "2026-05-15",
  },
  {
    id: "prov3", razonSocial: "Duo Matic S.R.L.", cuit: "30-71456789-0",
    condicionIva: "RI", email: "comercial@duomatic.com.ar", telefono: "011-4756-3200",
    direccion: "Av. Mitre 2800", localidad: "Avellaneda", provincia: "Buenos Aires",
    contactos: [{ id: "pct3", nombre: "Sergio Blanco", cargo: "Ventas", email: "sblanco@duomatic.com.ar", telefono: "11-6666-0003", principal: true }],
    rubro: "Bridas y fittings", formaPago: "Cheque 30 días", diasCuentaCorriente: 30,
    limiteCredito: 5000000, saldoCuentaCorriente: 1200000,
    listasDePrecios: ["lp3"], notas: "",
    clasificacionTags: ["Buen precio", "Entrega lenta"], marcas: "Duo Matic", clasificacionNota: "",
    activo: true, createdAt: "2023-09-20", updatedAt: "2026-05-08",
  },
  {
    id: "prov4", razonSocial: "Flexitallic Argentina S.A.", cuit: "30-61234567-8",
    condicionIva: "RI", email: "orders@flexitallic.com.ar", telefono: "011-4312-8900",
    direccion: "Ruta 9 km 232", localidad: "Campana", provincia: "Buenos Aires",
    contactos: [{ id: "pct4", nombre: "Natalia Ríos", cargo: "Inside Sales", email: "nrios@flexitallic.com.ar", telefono: "11-6666-0004", principal: true }],
    rubro: "Juntas y sellos industriales", formaPago: "Transferencia", diasCuentaCorriente: 45,
    limiteCredito: 3000000, saldoCuentaCorriente: 450000,
    listasDePrecios: ["lp4"], notas: "Importador directo. Plazo de entrega 15-20 días hábiles.",
    clasificacionTags: ["Importador", "Entrega lenta"], marcas: "Flexitallic, Garlock", clasificacionNota: "Importador directo, plazo largo pero buena calidad",
    activo: true, createdAt: "2024-02-10", updatedAt: "2026-04-30",
  },
  {
    id: "prov5", razonSocial: "Bulmax S.A.", cuit: "30-70345123-5",
    condicionIva: "RI", email: "ventas@bulmax.com.ar", telefono: "0341-460-2200",
    direccion: "Parque Industrial Alvear", localidad: "Rosario", provincia: "Santa Fe",
    contactos: [{ id: "pct5", nombre: "Martín Vega", cargo: "Comercial", email: "mvega@bulmax.com.ar", telefono: "341-666-0005", principal: true }],
    rubro: "Bulonería y fijaciones", formaPago: "E-cheque 30 días", diasCuentaCorriente: 30,
    limiteCredito: 2000000, saldoCuentaCorriente: 380000,
    listasDePrecios: ["lp5"], notas: "Stock permanente. Entrega en 48hs.",
    clasificacionTags: ["Buen precio", "Entrega rapida", "Stock permanente", "Nacional"], marcas: "Bulmax", clasificacionNota: "Muy buen proveedor, stock permanente y entrega rapida",
    activo: true, createdAt: "2024-05-01", updatedAt: "2026-05-12",
  },
  {
    id: "prov6", razonSocial: "WIKA Argentina S.A.", cuit: "30-62345678-9",
    condicionIva: "RI", email: "info@wika.com.ar", telefono: "011-4717-0707",
    direccion: "Av. Tomás Edison 2495", localidad: "Munro", provincia: "Buenos Aires",
    contactos: [{ id: "pct6", nombre: "Diego Campos", cargo: "Ventas técnicas", email: "dcampos@wika.com.ar", telefono: "11-6666-0006", principal: true }],
    rubro: "Instrumentación industrial", formaPago: "Transferencia 45 días", diasCuentaCorriente: 45,
    limiteCredito: 4000000, saldoCuentaCorriente: 920000,
    listasDePrecios: ["lp6"], notas: "Productos importados. Cotizar en USD.",
    clasificacionTags: ["Importador", "Buena calidad"], marcas: "WIKA", clasificacionNota: "Productos importados, cotizar en USD",
    activo: true, createdAt: "2023-11-15", updatedAt: "2026-05-05",
  },
];

// ── Listas de precios ────────────────────────────────────────────
export const mockListasPrecios: ListaPrecios[] = [
  {
    id: "lp1", nombre: "LP Giacomini — Mayo 2026", proveedorId: "prov1", proveedorNombre: "Giacomini Argentina S.A.",
    moneda: "ARS", vigenciaDesde: "2026-05-01", vigenciaHasta: "2026-06-30", estado: "vigente",
    items: [
      { id: "lpi1", codigo: "VAL-001", descripcion: "Válvula esférica 2\" AISI 316", categoria: "Válvulas", unidad: "u", precio: 48000, descuento: 5.8, precioNeto: 45200 },
      { id: "lpi2", codigo: "VAL-002", descripcion: "Válvula esférica 3\" AISI 316", categoria: "Válvulas", unidad: "u", precio: 72000, descuento: 5.8, precioNeto: 67824 },
      { id: "lpi3", codigo: "VAL-010", descripcion: "Válvula mariposa 4\" wafer", categoria: "Válvulas", unidad: "u", precio: 95000, descuento: 5.8, precioNeto: 89490 },
      { id: "lpi4", codigo: "VAL-015", descripcion: "Válvula globo 2\" 150#", categoria: "Válvulas", unidad: "u", precio: 62000, descuento: 5.8, precioNeto: 58404 },
    ],
    notas: "Descuento 5.8% aplicado. Vigencia 60 días. +3% por pago anticipado.",
    createdAt: "2026-05-01", updatedAt: "2026-05-01",
  },
  {
    id: "lp2", nombre: "LP Tenaris — Q2 2026", proveedorId: "prov2", proveedorNombre: "Tenaris S.A.",
    moneda: "ARS", vigenciaDesde: "2026-04-01", vigenciaHasta: "2026-06-30", estado: "vigente",
    items: [
      { id: "lpi5", codigo: "CAÑ-015", descripcion: "Caño acero SCH40 4\" x 6m", categoria: "Caños", unidad: "u", precio: 135000, descuento: 4.8, precioNeto: 128520 },
      { id: "lpi6", codigo: "CAÑ-020", descripcion: "Caño acero SCH40 6\" x 6m", categoria: "Caños", unidad: "u", precio: 210000, descuento: 4.8, precioNeto: 199920 },
      { id: "lpi7", codigo: "CAÑ-010", descripcion: "Caño acero SCH40 2\" x 6m", categoria: "Caños", unidad: "u", precio: 78000, descuento: 4.8, precioNeto: 74256 },
    ],
    notas: "Precios ex-planta Campana. Flete a cargo del comprador.",
    createdAt: "2026-04-01", updatedAt: "2026-04-01",
  },
  {
    id: "lp3", nombre: "LP Duo Matic — 2026", proveedorId: "prov3", proveedorNombre: "Duo Matic S.R.L.",
    moneda: "ARS", vigenciaDesde: "2026-01-01", vigenciaHasta: "2026-12-31", estado: "vigente",
    items: [
      { id: "lpi8", codigo: "BRI-008", descripcion: "Brida slip-on 6\" 150#", categoria: "Bridas", unidad: "u", precio: 71000, descuento: 4.5, precioNeto: 67805 },
      { id: "lpi9", codigo: "FIT-022", descripcion: "Codo 90° 2\" SCH40 SW", categoria: "Fittings", unidad: "u", precio: 19800, descuento: 4.5, precioNeto: 18909 },
      { id: "lpi10", codigo: "BRI-012", descripcion: "Brida WN 4\" 300#", categoria: "Bridas", unidad: "u", precio: 145000, descuento: 4.5, precioNeto: 138475 },
    ],
    notas: "Lista anual. Revisión trimestral de precios.",
    createdAt: "2026-01-01", updatedAt: "2026-04-15",
  },
  {
    id: "lp4", nombre: "LP Flexitallic — Abr 2026", proveedorId: "prov4", proveedorNombre: "Flexitallic Argentina S.A.",
    moneda: "USD", vigenciaDesde: "2026-04-01", vigenciaHasta: "2026-05-31", estado: "vencida",
    items: [
      { id: "lpi11", codigo: "JUN-003", descripcion: "Junta espirometálica 4\" 150#", categoria: "Juntas", unidad: "u", precio: 11.5, precioNeto: 11.5 },
      { id: "lpi12", codigo: "JUN-006", descripcion: "Junta espirometálica 6\" 150#", categoria: "Juntas", unidad: "u", precio: 18.2, precioNeto: 18.2 },
    ],
    notas: "Precios FOB en USD. VENCIDA — solicitar nueva lista.",
    createdAt: "2026-04-01", updatedAt: "2026-04-01",
  },
  {
    id: "lp5", nombre: "LP Bulmax — Mayo 2026", proveedorId: "prov5", proveedorNombre: "Bulmax S.A.",
    moneda: "ARS", vigenciaDesde: "2026-05-01", vigenciaHasta: "2026-07-31", estado: "vigente",
    items: [
      { id: "lpi13", codigo: "BUL-010", descripcion: "Bulón hexagonal M16x80 8.8 ZN", categoria: "Bulonería", unidad: "u", precio: 1320, descuento: 5.3, precioNeto: 1250 },
      { id: "lpi14", codigo: "BUL-011", descripcion: "Tuerca hexagonal M16 8.8 ZN", categoria: "Bulonería", unidad: "u", precio: 450, descuento: 5.3, precioNeto: 426 },
      { id: "lpi15", codigo: "BUL-020", descripcion: "Arandela plana M16 ZN", categoria: "Bulonería", unidad: "u", precio: 180, descuento: 5.3, precioNeto: 170 },
    ],
    notas: "Stock permanente. Descuento adicional 2% > 1000 unidades.",
    createdAt: "2026-05-01", updatedAt: "2026-05-01",
  },
  {
    id: "lp6", nombre: "LP WIKA — 2026", proveedorId: "prov6", proveedorNombre: "WIKA Argentina S.A.",
    moneda: "USD", vigenciaDesde: "2026-01-01", vigenciaHasta: "2026-12-31", estado: "vigente",
    items: [
      { id: "lpi16", codigo: "INS-005", descripcion: "Manómetro glicerina 0-10 bar 4\"", categoria: "Instrumentación", unidad: "u", precio: 32, precioNeto: 32 },
      { id: "lpi17", codigo: "INS-010", descripcion: "Termómetro bimetálico 0-200°C", categoria: "Instrumentación", unidad: "u", precio: 28, precioNeto: 28 },
    ],
    notas: "USD oficial + 10% IMP. Plazo de entrega 20 días.",
    createdAt: "2026-01-01", updatedAt: "2026-03-15",
  },
];

// ── Órdenes de compra ────────────────────────────────────────────
export const mockOrdenesCompra: OrdenCompra[] = [
  {
    id: "oc1", numero: "OC-2026-0031", proveedorId: "prov2", proveedorNombre: "Tenaris S.A.",
    fecha: "2026-05-16", fechaEntregaEstimada: "2026-05-28", estado: "confirmada",
    items: [
      { id: "oci1", productoId: "p2", codigo: "CAÑ-015", descripcion: "Caño acero SCH40 4\" x 6m", cantidad: 30, cantidadRecibida: 0, unidad: "u", precioUnitario: 128520, subtotal: 3855600 },
    ],
    subtotal: 3855600, iva: 809676, total: 4665276, moneda: "ARS",
    presupuestoOrigenId: "pr2", observaciones: "Para pedido Minera Andina. Entrega en planta Campana.",
    creadoPor: "u3", createdAt: "2026-05-16", updatedAt: "2026-05-17",
  },
  {
    id: "oc2", numero: "OC-2026-0032", proveedorId: "prov3", proveedorNombre: "Duo Matic S.R.L.",
    fecha: "2026-05-16", fechaEntregaEstimada: "2026-05-23", estado: "recibida",
    items: [
      { id: "oci2", productoId: "p3", codigo: "BRI-008", descripcion: "Brida slip-on 6\" 150#", cantidad: 60, cantidadRecibida: 60, unidad: "u", precioUnitario: 67805, subtotal: 4068300 },
      { id: "oci3", productoId: "p4", codigo: "FIT-022", descripcion: "Codo 90° 2\" SCH40 SW", cantidad: 40, cantidadRecibida: 40, unidad: "u", precioUnitario: 18909, subtotal: 756360 },
    ],
    subtotal: 4824660, iva: 1013179, total: 5837839, moneda: "ARS",
    observaciones: "Recibido completo 23/05", creadoPor: "u3", createdAt: "2026-05-16", updatedAt: "2026-05-23",
  },
  {
    id: "oc3", numero: "OC-2026-0033", proveedorId: "prov5", proveedorNombre: "Bulmax S.A.",
    fecha: "2026-05-18", fechaEntregaEstimada: "2026-05-20", estado: "enviada",
    items: [
      { id: "oci4", codigo: "BUL-010", descripcion: "Bulón hexagonal M16x80 8.8 ZN", cantidad: 500, cantidadRecibida: 0, unidad: "u", precioUnitario: 1250, subtotal: 625000 },
      { id: "oci5", codigo: "BUL-011", descripcion: "Tuerca hexagonal M16 8.8 ZN", cantidad: 500, cantidadRecibida: 0, unidad: "u", precioUnitario: 426, subtotal: 213000 },
    ],
    subtotal: 838000, iva: 175980, total: 1013980, moneda: "ARS",
    observaciones: "Reposición stock", creadoPor: "u3", createdAt: "2026-05-18", updatedAt: "2026-05-18",
  },
];

// ── Extractos bancarios ──────────────────────────────────────────
export const mockExtractos: ExtractoBancario[] = [
  {
    id: "ext1", banco: "Banco Galicia", cuenta: "CC ARS 4567-8", periodo: "Mayo 2026",
    fechaUpload: "2026-05-19", archivo: "extracto_galicia_mayo2026.xlsx",
    totalCreditos: 5800000, totalDebitos: 4375000, matcheados: 4, pendientes: 2,
    estado: "parcial",
    movimientos: [
      { id: "em1", fecha: "2026-05-14", descripcion: "TRF METALURGICA SAN MARTIN SA", referencia: "REF-78901", monto: 800000, tipo: "credito", matchFacturaId: "f1", matchClienteId: "c1", estado: "matcheado" },
      { id: "em2", fecha: "2026-05-16", descripcion: "TRF CONSTRUCTORA PATAGONIA SRL", referencia: "REF-78902", monto: 2000000, tipo: "credito", matchClienteId: "c2", estado: "matcheado" },
      { id: "em3", fecha: "2026-05-12", descripcion: "PAGO GIACOMINI ARGENTINA SA", referencia: "CHQ-45601", monto: 1520000, tipo: "debito", matchProveedorId: "prov1", estado: "matcheado" },
      { id: "em4", fecha: "2026-05-18", descripcion: "ECHEQ EMITIDO TENARIS SA", referencia: "ECH-90123", monto: 3855000, tipo: "debito", matchProveedorId: "prov2", estado: "matcheado" },
      { id: "em5", fecha: "2026-05-17", descripcion: "TRF CR 3000000590", referencia: "REF-78950", monto: 1500000, tipo: "credito", estado: "pendiente" },
      { id: "em6", fecha: "2026-05-19", descripcion: "TRF CR 3000000612", referencia: "REF-78965", monto: 1500000, tipo: "credito", estado: "pendiente" },
    ],
  },
];

// ── Líneas de crédito ────────────────────────────────────────────
export const mockLineasCredito: LineaCredito[] = [
  { id: "lc1", entidad: "Banco Galicia", tipo: "bancaria", montoTotal: 15000000, montoUtilizado: 8500000, montoDisponible: 6500000, moneda: "ARS", tasa: 65, vencimiento: "2026-12-31", estado: "activa", notas: "Línea de descuento de cheques", createdAt: "2026-01-15" },
  { id: "lc2", entidad: "Banco BBVA", tipo: "bancaria", montoTotal: 5000000, montoUtilizado: 2000000, montoDisponible: 3000000, moneda: "ARS", tasa: 72, vencimiento: "2026-09-30", estado: "activa", notas: "Acuerdo en CC para giro en descubierto", createdAt: "2026-03-01" },
  { id: "lc3", entidad: "Tenaris S.A.", tipo: "proveedor", proveedorId: "prov2", montoTotal: 20000000, montoUtilizado: 7800000, montoDisponible: 12200000, moneda: "ARS", vencimiento: "2026-12-31", estado: "activa", notas: "Crédito comercial, renovación automática", createdAt: "2022-06-01" },
  { id: "lc4", entidad: "Giacomini Argentina S.A.", tipo: "proveedor", proveedorId: "prov1", montoTotal: 8000000, montoUtilizado: 2350000, montoDisponible: 5650000, moneda: "ARS", vencimiento: "2026-12-31", estado: "activa", notas: "", createdAt: "2023-01-15" },
  { id: "lc5", entidad: "Banco Nación", tipo: "bancaria", montoTotal: 3000000, montoUtilizado: 3000000, montoDisponible: 0, moneda: "ARS", tasa: 58, vencimiento: "2026-06-30", estado: "activa", notas: "Línea agotada. Solicitar ampliación.", createdAt: "2025-07-01" },
];

// ── KPIs Dashboard ───────────────────────────────────────────────
export const dashboardKPIs = {
  ventasMes: 14726910,
  ventasMesAnterior: 11200000,
  presupuestosActivos: 3,
  presupuestosPendientes: 1,
  tasaConversion: 42,
  tasaConversionAnterior: 38,
  cobranzasMes: 3300000,
  cobranzasPendientes: 13830000,
  clientesActivos: 5,
  stockBajo: 1,
  facturadoMes: 14726910,
  margenPromedio: 36.5,
};

export const ventasPorMes = [
  { mes: "Dic", monto: 8500000 },
  { mes: "Ene", monto: 9200000 },
  { mes: "Feb", monto: 7800000 },
  { mes: "Mar", monto: 11200000 },
  { mes: "Abr", monto: 11200000 },
  { mes: "May", monto: 14726910 },
];

export const presupuestosPorEstado = [
  { estado: "Aprobados", cantidad: 22, color: "#22c55e" },
  { estado: "Pendientes", cantidad: 8, color: "#f59e0b" },
  { estado: "Rechazados", cantidad: 12, color: "#ef4444" },
  { estado: "Postergados", cantidad: 5, color: "#8b5cf6" },
];

export const topClientes = [
  { nombre: "Minera Andina", facturado: 14726910 },
  { nombre: "Constructora Patagonia", facturado: 8900000 },
  { nombre: "Petroquímica del Sur", facturado: 6200000 },
  { nombre: "Metalúrgica San Martín", facturado: 4800000 },
  { nombre: "Agro Insumos Litoral", facturado: 2100000 },
];
