# Traspaso — chat "Web"

## Objetivo
Rehacer desde cero la web de la empresa, **www.lazzari.com.ar** (hoy publicada en Netlify; su código **no está** en este repo).
Lo que pidió Augusto: **categorizar los productos** y darle **otra onda, totalmente distinta** a la de hoy: moderna y sutil a la vez.
Tiene que transmitir **"mega industria"**, seriedad y confianza (seguridad industrial / EPP / ropa de trabajo).

## Estado
- **Terminado y publicado:** nada.
- **Hecho sin publicar:** nada. No se tocó código, ni la base, ni Netlify.
- **A medias:** solo se propuso el plan (abajo). El 16/10 se le hicieron las 3 preguntas en el chat de Web; Augusto todavía no contestó.

## Prompt para seguir en un chat nuevo
```
Sos el chat de Web. Leé CLAUDE.md y docs/traspaso/web.md. Te contesto las 3 preguntas pendientes:
1) Webs que me gustan: [links]
2) Fotos: [propias / de stock]
3) La web: [solo mostrar + contacto / más adelante productos con precios del CRM]
Con esto, mirá la web actual y armá las 3 maquetas (A, B y C). No toques la web actual ni Netlify y no publiques nada.
```

## Plan propuesto (falta su OK)
1. Mirar la web actual (lazzari.com.ar) para aprovechar textos, logos, fotos y marcas.
2. Armar **3 maquetas visuales** para comparar en el navegador:
   - A. "Industria pesada": fondo oscuro, naranja Lazzari (#FF4500) como acento, fotos grandes de planta y obra.
   - B. "Corporativo limpio": blanco y gris con toque naranja, al estilo 3M / Honeywell.
   - C. "Técnico moderno": grilla, íconos por rubro, números grandes (años, clientes, marcas).
3. Augusto elige una o mezcla, y recién ahí se arma la web completa con las categorías: calzado, indumentaria,
   guantes, protección respiratoria, visual, auditiva, craneana, trabajo en altura y personalización (bordado/estampado).

## Preguntas pendientes a Augusto (próximo paso exacto)
1. ¿2 o 3 webs que le gusten (links)?
2. ¿Tiene fotos propias o se usan fotos de stock?
3. ¿Web para mostrar + contacto (WhatsApp/formulario), o más adelante productos con precios desde el CRM?
   (En ESTADO.md ya figura la idea de "conectar la web al CRM para precios".)

Con sus respuestas: hacer el paso 1 y después las 3 maquetas.

## Decisiones / restricciones
- La web nueva se arma aparte; **no tocar la web actual ni Netlify** hasta que Augusto lo diga.
- No crear ramas. No publicar sin su pedido.
- Precios: si algún día se muestran, salen del CRM / `catalogo_crm.csv` (regla 7 de CLAUDE.md); nunca a mano.

## Migraciones / errores conocidos
Ninguno.

## Ideas para después
- Conectar el catálogo del CRM a la web (categorías y, opcionalmente, precios).
- Botón de WhatsApp por vendedor y formulario de cotización que entre como oportunidad en el CRM.
