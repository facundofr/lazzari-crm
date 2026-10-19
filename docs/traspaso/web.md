# Traspaso — chat "Web"

## Objetivo
Rehacer desde cero la web de la empresa, **www.lazzari.com.ar** (hoy publicada en Netlify; su código **no está** en este repo).
Lo que pidió Augusto: **categorizar los productos** y darle **otra onda, totalmente distinta** a la de hoy: moderna y sutil a la vez.
Tiene que transmitir **"mega industria"**, seriedad y confianza (seguridad industrial / EPP / ropa de trabajo).

## Lo que es hoy la web actual (mirada 17/10, sin tocar)
Ya es una **lista de precios B2B**: 2.656 productos con precio (sin IVA, vigente 08/10/2026), carrito "Mi pedido" que se envía por WhatsApp,
"Ofertas 3M", "Cómo usar", 19 marcas (3M, Pampero, Funcional, Ombú, Grafa 70, Pegaso, ATT, Libus, Fravida, Voran, Startex, Conoflex,
Mediglove, Firestone, Escorpio, DPS, Ecoway, Línea Económica, Aire Libre). Contacto: ventas@lazzari.com.ar, WhatsApp comercial, Buenos Aires.
Fondo oscuro con naranja. Casi sin fotos de producto. La nueva web tiene que **mantener todo eso** (precios + pedido por WhatsApp).

## Respuestas de Augusto (17/10)
- **Estilo:** le gustan 3 afiches de referencia: negro + naranja + blanco, letras enormes en mayúscula, flechas y franjas diagonales,
  numeración 01/02/03, texto vertical, textura de papel arrugado. (Encaja con su logo: el isotipo ya es diagonal naranja.)
- **Fotos:** todavía casi no tiene; hay que ver cómo conseguirlas.
- **Productos:** sí, más adelante con productos y precios (desde el CRM).

## Estado
- **Terminado y publicado:** nada.
- **Hecho sin publicar (no está en git, a propósito):** 2 maquetas en `web/maquetas/` (reemplazan a las A/B/C del plan viejo):
  - `variante-1-afiche.html` — "Afiche": negro, franjas diagonales, rubros como afiches verticales numerados con textura de papel.
  - `variante-2-sobrio.html` — "Afiche sobrio": fondo claro, letras negras grandes, naranja de acento, rubros como índice numerado.
  - Para verlas con doble clic: `web/maquetas/ver/*.html` (copias con el logo embebido; se regeneran con un script chico que
    reemplaza `src="img/*.png"` por base64). Logo sacado de la web actual: `web/maquetas/img/logo-mk.png` y `logo-wm.png`.
  - Probadas en compu y celular (sin corrimiento horizontal). Precios de muestra copiados de la web actual; fotos = espacios "FOTO DEL PRODUCTO".
  - **17/10, ajuste pedido por Augusto ("más delicado, todo muy grande"):** en las dos se bajaron los títulos ~40 %, letra 700 en vez de 900,
    franjas diagonales más finas, afiches de rubros más bajos (340 px), números, botones y espacios más chicos. Las versiones grandes
    quedaron en `web/maquetas/anteriores/` (sin logo embebido).
- **Pendiente:** que Augusto elija variante (o mezcla) y diga qué cambiar.

## Prompt para seguir en un chat nuevo
```
Sos el chat de Web. Leé CLAUDE.md y docs/traspaso/web.md. Ya vi las maquetas de web/maquetas/ver/.
Elijo: [Variante 1 / Variante 2 / mezcla: ...]. Cambios: [...].
No toques la web actual ni Netlify y no publiques nada.
```

## Próximos pasos
1. Augusto elige variante y ajustes.
2. Fotos: definir fuente (fotos oficiales de las marcas/proveedores, sesión propia en el depósito, o generadas con IA para portadas de rubro).
3. Armar la web completa: inicio + páginas por rubro + lista de precios con filtros + pedido por WhatsApp.
4. Después: precios desde el CRM / `catalogo_crm.csv`; dónde se publica (seguir en Netlify o pasar a Vercel) lo decide Augusto.

## Decisiones / restricciones
- La web nueva se arma aparte; **no tocar la web actual ni Netlify** hasta que Augusto lo diga.
- No crear ramas. No publicar sin su pedido.
- Precios: salen del CRM / `catalogo_crm.csv` (regla 7 de CLAUDE.md); nunca a mano.

## Migraciones / errores conocidos
Ninguno.

## Ideas para después
- Conectar el catálogo del CRM a la web (categorías y precios).
- Botón de WhatsApp por vendedor y formulario de cotización que entre como oportunidad en el CRM.
