# Lazzari Soluciones Industriales — Plan de Proyecto

**Cliente:** Lazzari Soluciones Industriales
**Agencia:** Broos
**Fecha:** 19 May 2026
**Inversion total:** USD 4.200

---

## Resumen de la propuesta

Tres componentes integrados que se trabajan en paralelo:

| Componente | Inversion | Anticipo | Saldo |
|---|---|---|---|
| Web institucional | USD 700 | USD 350 | USD 350 |
| Identidad visual | BONIFICADO | — | — |
| CRM / Sistema de gestion | USD 3.500 | USD 1.750 | USD 1.750 |
| **Total** | **USD 4.200** | **USD 2.100** | **USD 2.100** |

---

## 1. DISENO — Identidad visual + imagen de marca (BONIFICADO)

**Carpeta:** `diseno/`

### Tareas en paralelo:

- [ ] **Branding** (`diseno/branding/`)
  - [ ] Rediseno / refinamiento del logo
  - [ ] Definicion de paleta de colores (actual: naranja #FF4500, negro #111, grises, blanco/crema)
  - [ ] Tipografias (actual: Inter + DM Sans)
  - [ ] Manual de marca digital (aplicaciones, usos correctos)

- [ ] **UI/UX** (`diseno/ui-ux/`)
  - [ ] Wireframes de la web institucional
  - [ ] Wireframes del CRM (dashboard, fichas, presupuestos)
  - [ ] Sistema de componentes UI (botones, inputs, tarjetas, tablas)
  - [ ] Prototipo navegable

- [ ] **Assets** (`diseno/assets/`)
  - [ ] Logo en formatos (SVG, PNG, favicon)
  - [ ] Iconografia
  - [ ] Imagenes y recursos graficos

---

## 2. WEB — Sitio institucional portfolio (USD 700)

**Carpeta:** `web/`

### Paginas (`web/pages/`):

- [ ] **Home** — Hero + presentacion + marcas/categorias + CTA
- [ ] **Empresa** — Historia, valores, equipo, estadisticas
- [ ] **Productos/Servicios** — Lineas de productos industriales
- [ ] **Contacto** — Formulario + mapa + WhatsApp + datos

### Componentes (`web/components/`):

- [ ] Navbar fija con menu responsive (hamburguesa < 900px)
- [ ] Footer con links y datos legales
- [ ] Brand strip / carrusel marquee de marcas
- [ ] Tarjetas de productos/servicios
- [ ] Formulario de contacto
- [ ] Widget WhatsApp flotante
- [ ] Animaciones reveal con delays escalonados

### Especificaciones tecnicas:

- Responsive (desktop, tablet, mobile)
- SEO optimizado
- Performance (Core Web Vitals)
- Stack: por definir (sugerido: Next.js + Tailwind)

### Referencia de diseno actual (lazzari.com.ar):

- Estilo: minimalista corporativo
- Colores: naranja #FF4500, negro #111, gris #636363/#909090, blanco #FAFAFA, crema #F2F1EF
- Tipografias: Inter (labels/menus), DM Sans (cuerpo)
- Animaciones sutiles, hover elegantes, backdrop blur en nav

---

## 3. CRM — Sistema de gestion integral (USD 3.500)

**Carpeta:** `crm/`

### Modulo: Clientes y base de datos (`crm/clientes/`)

- [ ] Ficha de cliente 360: logistica, correos, sucursales, listas de precios, dias CC, formas de pago
- [ ] Historial inteligente: que cotizo, que compro, a que precio, cual fue la respuesta
- [ ] Base de productos por cliente (articulos habituales)
- [ ] Busqueda y filtros avanzados

### Modulo: Presupuestos / PR (`crm/presupuestos/`)

- [ ] Estados: Pendiente / Aprobado / Rechazado / Postergado (con motivo de rechazo)
- [ ] Carga manual de costo desde el presupuesto
- [ ] Base de articulos de todos los proveedores (respaldo de costos)
- [ ] Markup configurable: % general por PR + % por articulo
- [ ] Detalle por linea: cod, articulo, categoria, precio costo, % markup, precio venta, subtotal, IVA, total
- [ ] Envio del PR directamente desde el sistema
- [ ] Vista historica: al reabrir PR viejo se ve el markup original

### Modulo: Facturacion AFIP (`crm/facturacion/`)

- [ ] Facturacion conectada a AFIP desde el flujo del presupuesto
- [ ] Generacion de comprobantes fiscales
- [ ] Integracion con API AFIP (webservices WSFE)

### Modulo: Remitos con CAE (`crm/remitos/`)

- [ ] Generacion de remitos desde el sistema
- [ ] Obtencion de CAE
- [ ] Asistencia de IA para carga rapida

### Modulo: Stock (`crm/stock/`)

- [ ] Carga de stock desde facturas de compra de proveedores
- [ ] Control de inventario

### Modulo: Finanzas (`crm/finanzas/`)

- [ ] Cuentas corrientes de clientes
- [ ] Cuentas corrientes de proveedores
- [ ] Conciliacion bancaria
- [ ] Seguimiento de e-cheques emitidos y recibidos

### Modulo: Integraciones (`crm/integraciones/`)

- [ ] AFIP — CAE y facturacion electronica
- [ ] Bancos — cuentas corrientes y e-cheques
- [ ] Email — envio de PR desde el sistema

### Modulo: IA (`crm/ia/`)

- [ ] Asistencia en remitos (carga automatizada)
- [ ] Carga inteligente de documentos
- [ ] Analisis de motivos de rechazo para ajustar estrategia

### CRM del dia a dia:

- [ ] Dashboard con metricas clave
- [ ] Alertas y recordatorios (consultas, vencimientos)
- [ ] Reportes comerciales
- [ ] Analisis de motivos de rechazo

---

## Flujo de trabajo en paralelo

```
SEMANA 1-2          SEMANA 3-4          SEMANA 5-6          SEMANA 7-8
    |                   |                   |                   |
[DISENO]            [DISENO]            [DISENO]
 Branding            UI/UX CRM           Assets finales
 Paleta/Logo         Wireframes          Entregables
    |                   |                   |
[WEB]               [WEB]               [WEB]               [WEB]
 Estructura          Paginas             Responsive           Deploy
 Componentes         Contenido           SEO/Perf            Go-live
    |                   |                   |                   |
[CRM]               [CRM]               [CRM]               [CRM]
 DB Schema           Presupuestos        Facturacion          Testing
 Clientes            Stock/Finanzas      AFIP/Bancos          Go-live
 Auth/Roles          Remitos             IA module            Validacion
```

---

## Requisitos del cliente

- [ ] Designar referente para validar reglas de negocio (markup, listas, formas de pago)
- [ ] Proveer accesos AFIP (certificados digitales, CUIT)
- [ ] Proveer accesos bancarios para integraciones
- [ ] Entregar listas de precios de proveedores
- [ ] Validar contenido institucional para la web

---

## Equipo Broos

- Product Manager
- UI/UX Designer
- Desarrollador Full-Stack
- Especialista en integraciones (AFIP / bancos / IA)
