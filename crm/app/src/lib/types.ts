// ── Roles y permisos ──────────────────────────────────────────────
export type Role = "super_admin" | "admin" | "vendedor" | "administrativo" | "viewer";

export interface Permission {
  module: string;
  actions: ("read" | "create" | "update" | "delete" | "export")[];
}

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Super Admin",
  admin: "Administrador",
  vendedor: "Vendedor",
  administrativo: "Administrativo",
  viewer: "Solo lectura",
};

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  super_admin: [
    { module: "*", actions: ["read", "create", "update", "delete", "export"] },
  ],
  admin: [
    { module: "dashboard", actions: ["read", "export"] },
    { module: "clientes", actions: ["read", "create", "update", "delete", "export"] },
    { module: "presupuestos", actions: ["read", "create", "update", "delete", "export"] },
    { module: "facturacion", actions: ["read", "create", "update", "export"] },
    { module: "remitos", actions: ["read", "create", "update", "export"] },
    { module: "stock", actions: ["read", "create", "update", "export"] },
    { module: "finanzas", actions: ["read", "create", "update", "export"] },
    { module: "reportes", actions: ["read", "export"] },
    { module: "proveedores", actions: ["read", "create", "update", "delete", "export"] },
    { module: "listas_precios", actions: ["read", "create", "update", "delete", "export"] },
    { module: "ordenes_compra", actions: ["read", "create", "update", "delete", "export"] },
    { module: "extractos", actions: ["read", "create", "update", "export"] },
    { module: "lineas_credito", actions: ["read", "create", "update", "export"] },
    { module: "configuracion", actions: ["read", "update"] },
  ],
  vendedor: [
    { module: "dashboard", actions: ["read"] },
    { module: "clientes", actions: ["read", "create", "update"] },
    { module: "presupuestos", actions: ["read", "create", "update"] },
    { module: "remitos", actions: ["read", "create"] },
    { module: "proveedores", actions: ["read"] },
    { module: "listas_precios", actions: ["read"] },
    { module: "stock", actions: ["read"] },
    { module: "reportes", actions: ["read"] },
  ],
  administrativo: [
    { module: "dashboard", actions: ["read"] },
    { module: "clientes", actions: ["read", "update"] },
    { module: "presupuestos", actions: ["read", "update"] },
    { module: "facturacion", actions: ["read", "create", "update", "export"] },
    { module: "remitos", actions: ["read", "create", "update", "export"] },
    { module: "stock", actions: ["read", "create", "update"] },
    { module: "finanzas", actions: ["read", "create", "update", "export"] },
    { module: "proveedores", actions: ["read", "create", "update", "export"] },
    { module: "listas_precios", actions: ["read", "create", "update", "export"] },
    { module: "ordenes_compra", actions: ["read", "create", "update", "export"] },
    { module: "extractos", actions: ["read", "create", "update", "export"] },
    { module: "lineas_credito", actions: ["read", "create", "update", "export"] },
    { module: "reportes", actions: ["read", "export"] },
  ],
  viewer: [
    { module: "dashboard", actions: ["read"] },
    { module: "clientes", actions: ["read"] },
    { module: "presupuestos", actions: ["read"] },
    { module: "facturacion", actions: ["read"] },
    { module: "stock", actions: ["read"] },
    { module: "reportes", actions: ["read"] },
  ],
};

// ── Usuarios ─────────────────────────────────────────────────────
export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  avatar?: string;
  active: boolean;
  createdAt: string;
}

// ── Clientes ─────────────────────────────────────────────────────
export type ClientType = "empresa" | "persona";

export interface Client {
  id: string;
  type: ClientType;
  razonSocial: string;
  cuit: string;
  condicionIva: "RI" | "Monotributo" | "Exento" | "CF";
  email: string;
  telefono: string;
  direccion: string;
  localidad: string;
  provincia: string;
  cp: string;
  sucursales: Sucursal[];
  contactos: Contacto[];
  listaPrecio: string;
  diasCuentaCorriente: number;
  formaPago: string;
  limiteCredito: number;
  saldoCuentaCorriente: number;
  notas: string;
  activo: boolean;
  createdAt: string;
  updatedAt: string;
  assignedTo?: string; // vendedor asignado
}

export interface Sucursal {
  id: string;
  nombre: string;
  direccion: string;
  localidad: string;
  provincia: string;
  telefono: string;
  email?: string;
  cp?: string;
}

export interface Contacto {
  id: string;
  nombre: string;
  cargo: string;
  email: string;
  telefono: string;
  principal: boolean;
  fechaCumpleanos?: string | null;
  notas?: string | null;
  sucursalId?: string | null;
}

// ── Productos / Articulos ────────────────────────────────────────
export interface Product {
  id: string;
  codigo: string;
  nombre: string;
  categoria: string;
  proveedor: string;
  precioCosto: number;
  monedaCosto: "USD" | "ARS";
  unidad: string;
  iva: number; // 21, 10.5, 27, 0
  stock: number;
  stockMinimo: number;
  activo: boolean;
  updatedAt: string;
}

// ── Presupuestos ─────────────────────────────────────────────────
export type PRStatus = "borrador" | "pendiente" | "aprobado" | "rechazado" | "postergado" | "vencido";

export interface Presupuesto {
  id: string;
  numero: string;
  clienteId: string;
  clienteNombre: string;
  fecha: string;
  vencimiento: string;
  estado: PRStatus;
  motivoRechazo?: string;
  markupGeneral: number;
  items: PresupuestoItem[];
  subtotal: number;
  iva: number;
  total: number;
  moneda: "USD" | "ARS";
  observaciones: string;
  creadoPor: string;
  vendedorId?: string;
  vendedorNombre?: string;
  vendedorAvatar?: string | null;
  enviadoAt?: string;
  respondidoAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PresupuestoItem {
  id: string;
  productoId: string;
  codigo: string;
  descripcion: string;
  categoria: string;
  cantidad: number;
  unidad: string;
  precioCosto: number;
  markupPorcentaje: number;
  precioVenta: number;
  subtotal: number;
  iva: number;
  total: number;
}

// ── Facturacion ──────────────────────────────────────────────────
export type ComprobanteType = "FA" | "FB" | "FC" | "NCA" | "NCB" | "NCC" | "NDA" | "NDB" | "NDC";

export interface Factura {
  id: string;
  tipo: ComprobanteType;
  puntoVenta: number;
  numero: number;
  clienteId: string;
  clienteNombre: string;
  presupuestoId?: string;
  fecha: string;
  cae: string;
  caeVencimiento: string;
  items: FacturaItem[];
  subtotal: number;
  iva: number;
  total: number;
  estado: "emitida" | "pagada" | "anulada" | "vencida";
  createdAt: string;
}

export interface FacturaItem {
  id: string;
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
  iva: number;
  subtotal: number;
}

// ── Remitos ──────────────────────────────────────────────────────
export interface Remito {
  id: string;
  numero: string;
  clienteId: string;
  clienteNombre: string;
  presupuestoId?: string;
  fecha: string;
  cae?: string;
  items: RemitoItem[];
  estado: "pendiente" | "entregado" | "parcial";
  observaciones: string;
  createdAt: string;
}

export interface RemitoItem {
  id: string;
  productoId: string;
  descripcion: string;
  cantidad: number;
  unidad: string;
}

// ── Finanzas ─────────────────────────────────────────────────────
export type MovimientoTipo = "cobro" | "pago" | "cheque_emitido" | "cheque_recibido" | "transferencia" | "efectivo";

export interface Movimiento {
  id: string;
  tipo: MovimientoTipo;
  clienteId?: string;
  proveedorId?: string;
  descripcion: string;
  monto: number;
  fecha: string;
  facturaId?: string;
  conciliado: boolean;
  createdAt: string;
}

// ── Actividad / Audit Log ────────────────────────────────────────
export interface ActivityLog {
  id: string;
  userId: string;
  userName: string;
  action: string;
  module: string;
  entityId?: string;
  details: string;
  createdAt: string;
}

// ── Alertas ──────────────────────────────────────────────────────
// ── Proveedores ──────────────────────────────────────────────────
export interface Proveedor {
  id: string;
  razonSocial: string;
  cuit: string;
  condicionIva: "RI" | "Monotributo" | "Exento";
  email: string;
  telefono: string;
  direccion: string;
  localidad: string;
  provincia: string;
  contactos: Contacto[];
  rubro: string;
  formaPago: string;
  diasCuentaCorriente: number;
  limiteCredito: number;
  saldoCuentaCorriente: number;
  listasDePrecios: string[]; // IDs de listas asociadas
  notas: string;
  clasificacionTags: string[];
  marcas: string;
  clasificacionNota: string;
  activo: boolean;
  createdAt: string;
  updatedAt: string;
}

// ── Listas de precios ────────────────────────────────────────────
export interface ListaPrecios {
  id: string;
  nombre: string;
  proveedorId: string;
  proveedorNombre: string;
  moneda: "USD" | "ARS";
  vigenciaDesde: string;
  vigenciaHasta: string;
  estado: "vigente" | "vencida" | "borrador";
  items: ListaPreciosItem[];
  archivoOrigen?: string;
  notas: string;
  createdAt: string;
  updatedAt: string;
}

export interface ListaPreciosItem {
  id: string;
  codigo: string;
  descripcion: string;
  categoria: string;
  unidad: string;
  precio: number;
  descuento?: number;
  precioNeto: number;
}

// ── Órdenes de compra ────────────────────────────────────────────
export type OCStatus = "borrador" | "enviada" | "confirmada" | "recibida_parcial" | "recibida" | "cancelada";

export interface OrdenCompra {
  id: string;
  numero: string;
  proveedorId: string;
  proveedorNombre: string;
  fecha: string;
  fechaEntregaEstimada: string;
  estado: OCStatus;
  items: OrdenCompraItem[];
  subtotal: number;
  iva: number;
  total: number;
  moneda: "USD" | "ARS";
  presupuestoOrigenId?: string;
  observaciones: string;
  creadoPor: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrdenCompraItem {
  id: string;
  productoId?: string;
  codigo: string;
  descripcion: string;
  cantidad: number;
  cantidadRecibida: number;
  unidad: string;
  precioUnitario: number;
  subtotal: number;
}

// ── Extractos bancarios ──────────────────────────────────────────
export interface ExtractoBancario {
  id: string;
  banco: string;
  cuenta: string;
  periodo: string;
  fechaUpload: string;
  archivo: string;
  movimientos: ExtractoMovimiento[];
  totalCreditos: number;
  totalDebitos: number;
  matcheados: number;
  pendientes: number;
  estado: "procesando" | "parcial" | "conciliado";
}

export interface ExtractoMovimiento {
  id: string;
  fecha: string;
  descripcion: string;
  referencia: string;
  monto: number;
  tipo: "credito" | "debito";
  matchFacturaId?: string;
  matchClienteId?: string;
  matchProveedorId?: string;
  estado: "matcheado" | "pendiente" | "ignorado";
}

// ── Líneas de crédito ────────────────────────────────────────────
export interface LineaCredito {
  id: string;
  entidad: string; // banco o proveedor
  tipo: "bancaria" | "proveedor";
  proveedorId?: string;
  montoTotal: number;
  montoUtilizado: number;
  montoDisponible: number;
  moneda: "USD" | "ARS";
  tasa?: number;
  vencimiento: string;
  estado: "activa" | "vencida" | "suspendida";
  notas: string;
  createdAt: string;
}

// ── Gastos fijos ────────────────────────────────────────────────
export interface GastoFijo {
  id: string;
  descripcion: string;
  categoria: string;
  monto: number;
  moneda: "USD" | "ARS";
  activo: boolean;
  notas: string;
  createdAt: string;
}

// ── Objetivos ───────────────────────────────────────────────────
export type ObjetivoTipo = "ventas" | "facturacion" | "cobranza" | "margen";

export interface Objetivo {
  id: string;
  nombre: string;
  tipo: ObjetivoTipo;
  montoTarget: number;
  moneda: "USD" | "ARS";
  periodoInicio: string;
  periodoFin: string;
  usuarioId: string | null;
  usuarioNombre?: string;
  activo: boolean;
  notas: string;
  createdAt: string;
}

export type AlertType = "vencimiento_pr" | "stock_bajo" | "cc_vencida" | "cheque_proximo" | "seguimiento";

export interface Alert {
  id: string;
  type: AlertType;
  title: string;
  description: string;
  entityId?: string;
  module: string;
  read: boolean;
  createdAt: string;
}
