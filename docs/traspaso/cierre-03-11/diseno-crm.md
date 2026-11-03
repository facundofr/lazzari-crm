# Diseño CRM — estado al 03/11/2026 (para el chat CRM)

El chat Diseño CRM **sigue abierto** (todo lo visual). Esto es para que el chat CRM sepa qué hay.

## Publicado (nada de código a medias)
- V1.1.625: PDF con tablas largas (`lib/pdf-cortes.ts`).
- V1.1.626: diseño nuevo (Propuesta 2), clases `dn-*` en `globals.css`.
- V1.1.628: Ordenar menú (`lib/orden-menu.ts`, `/api/orden-menu`, `sidebar.tsx`); orden en `configuracion` fila `orden_menu`.
- V1.1.636 (23481df): PDF de varias hojas con encabezado repetido y "Hoja N de M" (`.pdf-repetir` en `pdf-templates.ts`); "Diseño nuevo para todos" (`/api/diseno-nuevo`, fila `diseno_nuevo_todos`, **prendido**); helper `lib/config-global-server.ts` (lo usan las dos rutas).

## Sin código, solo propuestas (esperan a Augusto)
- **"CRM Lazzari 2026"** (oscuro; menú = 5 pasos Vender/Comprar/Entregar/Facturar/Cobrar y pagar; Ctrl K con IA; Hoy; Mapa de dónde va cada cosa): https://claude.ai/artifact/7w8xVDTdLkSwdZCsMq3fN3. Augusto lo dejó "para después".
- **Inicio (`/inicio`, `components/tablero-inicio.tsx`) rediseñado** (02/11): 4 semáforos (banco/semana, facturado vs ritmo, en la calle con vencido y "reclamar", IVA del mes "para no contadores" con barrita ventas − compras − retenciones − percepciones − saldo a favor), lista "para hacer hoy", próximas semanas en una línea. Falta que Augusto decida si la tarjeta del banco dice "falta / sobra" (el 28/10 pidió que no) o solo "a cubrir". El cálculo del IVA estimado sería lógica nueva: le toca al chat CRM (Diseño solo lo dibuja).

## Para coordinar
- Antes de tocar una pantalla, Diseño mira origin/main y `docs/ESTADO.md` por cambios sin publicar del chat CRM.
- Copia de trabajo de Diseño: worktree `menu-wt` en el scratchpad de este chat (sobre 23481df), servidor `crm-menu` (3012) en `.claude/launch.json`.
