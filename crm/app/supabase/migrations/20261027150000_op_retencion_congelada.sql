-- La retención queda «congelada» en la OP (auditoría de Impuestos, mejora H; Augusto 27/10: "Avanzá con los 6 puntos de la mejora H").
-- Hasta hoy la OP guardaba bruto, neto sin IVA, % y retenido, pero no con qué régimen y mínimo se calculó: el TXT SICORE,
-- el Excel y el certificado usaban el concepto que el proveedor tiene HOY (caso OP-000049).
-- SOLO AGREGA: cuatro columnas vacías en ordenes_pago y en movimientos (pagos directos con retención). No cambia ni borra datos.
-- Las anota la ventana de OP al guardar (orden-pago-nueva.tsx); las 49 OP con retención de antes se completan aparte
-- (20261027151000_op_retencion_congelada_datos.sql).
-- Vuelta atrás: supabase/rollback/20261027150000_op_retencion_congelada.sql
-- Prueba (no guarda nada): node scripts/db/migrar.cjs supabase/migrations/20261027150000_op_retencion_congelada.sql --probar scripts/db/pruebas/op_retencion_congelada.sql

alter table public.ordenes_pago add column if not exists retencion_ganancias_regimen text;
alter table public.ordenes_pago add column if not exists retencion_ganancias_minimo numeric(14,2);
alter table public.ordenes_pago add column if not exists retencion_ganancias_base_previa numeric(14,2);
alter table public.ordenes_pago add column if not exists retencion_ganancias_retenido_antes numeric(14,2);

alter table public.movimientos add column if not exists retencion_ganancias_regimen text;
alter table public.movimientos add column if not exists retencion_ganancias_minimo numeric(14,2);
alter table public.movimientos add column if not exists retencion_ganancias_base_previa numeric(14,2);
alter table public.movimientos add column if not exists retencion_ganancias_retenido_antes numeric(14,2);

-- El régimen es el código SICORE de 3 dígitos (ej. '078' bienes, '094' servicios, '095' transporte, '116' honorarios).
alter table public.ordenes_pago drop constraint if exists ordenes_pago_retencion_ganancias_regimen_check;
alter table public.ordenes_pago add constraint ordenes_pago_retencion_ganancias_regimen_check
  check (retencion_ganancias_regimen is null or retencion_ganancias_regimen ~ '^[0-9]{3}$');
alter table public.movimientos drop constraint if exists movimientos_retencion_ganancias_regimen_check;
alter table public.movimientos add constraint movimientos_retencion_ganancias_regimen_check
  check (retencion_ganancias_regimen is null or retencion_ganancias_regimen ~ '^[0-9]{3}$');

comment on column public.ordenes_pago.retencion_ganancias_regimen is 'Régimen SICORE con que se calculó la retención de Ganancias (mejora H). Vacío: OP sin anotar, se usa el concepto de hoy del proveedor.';
comment on column public.ordenes_pago.retencion_ganancias_minimo is 'Mínimo no sujeto a retención que usó la OP.';
comment on column public.ordenes_pago.retencion_ganancias_base_previa is 'Pagos anteriores del mes al proveedor (sin IVA) que sumó la OP.';
comment on column public.ordenes_pago.retencion_ganancias_retenido_antes is 'Retenido antes en el mes que restó la OP.';
comment on column public.movimientos.retencion_ganancias_regimen is 'Pago directo con retención: régimen SICORE con que se calculó (mejora H).';
comment on column public.movimientos.retencion_ganancias_minimo is 'Pago directo con retención: mínimo no sujeto que usó.';
comment on column public.movimientos.retencion_ganancias_base_previa is 'Pago directo con retención: pagos anteriores del mes (sin IVA).';
comment on column public.movimientos.retencion_ganancias_retenido_antes is 'Pago directo con retención: retenido antes en el mes.';
