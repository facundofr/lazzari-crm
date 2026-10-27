-- Completa la retención «congelada» de las 49 OP con retención de antes de la mejora H (auditoría de Impuestos;
-- Augusto 27/10: "Avanzá con los 6 puntos de la mejora H ... la OP-000049 queda como bienes (78)").
-- Cada OP anota con qué régimen, mínimo, pagos anteriores del mes y retenido antes se calculó. Los valores salen de la misma
-- cuenta del certificado (lib/certificado-retencion.ts), que da exacta en las 49: todas con el concepto que el proveedor tiene
-- hoy, salvo la OP-000049 (Speed Business), que se calculó como bienes (2 %, mínimo $ 224.000) y hoy está en transporte.
-- SOLO COMPLETA las 4 columnas nuevas de esas OP. No cambia importes, % ni retenido. Pagos directos con retención: 0.
-- Cada update exige la OP sin anotar y con el mismo retenido; si alguna no coincide, no se guarda nada.
-- Requiere 20261027150000_op_retencion_congelada.sql.
-- Por régimen: 078 → 49.
-- Vuelta atrás: supabase/rollback/20261027151000_op_retencion_congelada_datos.sql
-- Prueba (no guarda nada): node scripts/db/migrar.cjs supabase/migrations/20261027151000_op_retencion_congelada_datos.sql --probar scripts/db/pruebas/op_retencion_congelada_datos.sql

-- OP-000009 · 2026-09-15 · BRUNO FRANCIONE
update public.ordenes_pago set retencion_ganancias_regimen = '078', retencion_ganancias_minimo = 224000.00, retencion_ganancias_base_previa = 0.00, retencion_ganancias_retenido_antes = 0.00
 where id = 'b8201072-e55a-4688-b03d-8b1ec5e91d71' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and retencion_ganancias_regimen is null and retencion_ganancias_monto = 132160.00;

-- OP-000010 · 2026-09-15 · AIR PRODUCTS S R L
update public.ordenes_pago set retencion_ganancias_regimen = '078', retencion_ganancias_minimo = 224000.00, retencion_ganancias_base_previa = 0.00, retencion_ganancias_retenido_antes = 0.00
 where id = 'a56b938e-d1da-41d6-adc5-124849974d2c' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and retencion_ganancias_regimen is null and retencion_ganancias_monto = 2720.00;

-- OP-000011 · 2026-09-15 · STAR-TEX SA
update public.ordenes_pago set retencion_ganancias_regimen = '078', retencion_ganancias_minimo = 224000.00, retencion_ganancias_base_previa = 0.00, retencion_ganancias_retenido_antes = 0.00
 where id = 'e8a80b29-c694-46c1-969d-3da5c3167f53' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and retencion_ganancias_regimen is null and retencion_ganancias_monto = 39670.37;

-- OP-000012 · 2026-09-15 · VECHER S.A.
update public.ordenes_pago set retencion_ganancias_regimen = '078', retencion_ganancias_minimo = 224000.00, retencion_ganancias_base_previa = 0.00, retencion_ganancias_retenido_antes = 0.00
 where id = 'f6984e29-e682-4a6f-b40e-76db00bb0e9f' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and retencion_ganancias_regimen is null and retencion_ganancias_monto = 10943.93;

-- OP-000014 · 2026-09-15 · SERENPLAS SRL
update public.ordenes_pago set retencion_ganancias_regimen = '078', retencion_ganancias_minimo = 224000.00, retencion_ganancias_base_previa = 210725.91, retencion_ganancias_retenido_antes = 0.00
 where id = 'e55fb27c-ae24-4ac0-a2c9-520a1ab4208d' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and retencion_ganancias_regimen is null and retencion_ganancias_monto = 885.29;

-- OP-000016 · 2026-09-15 · TKW S.A.
update public.ordenes_pago set retencion_ganancias_regimen = '078', retencion_ganancias_minimo = 224000.00, retencion_ganancias_base_previa = 206833.06, retencion_ganancias_retenido_antes = 0.00
 where id = '62b9de21-a936-4342-a7d3-182388a89450' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and retencion_ganancias_regimen is null and retencion_ganancias_monto = 525.36;

-- OP-000017 · 2026-09-18 · TRIPODI DOMINGO JOSE
update public.ordenes_pago set retencion_ganancias_regimen = '078', retencion_ganancias_minimo = 224000.00, retencion_ganancias_base_previa = 0.00, retencion_ganancias_retenido_antes = 0.00
 where id = '90b8e25d-457b-49c5-b1fa-babbf7e49928' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and retencion_ganancias_regimen is null and retencion_ganancias_monto = 6136.00;

-- OP-000018 · 2026-09-18 · MARIANO JOSE DALBY
update public.ordenes_pago set retencion_ganancias_regimen = '078', retencion_ganancias_minimo = 224000.00, retencion_ganancias_base_previa = 0.00, retencion_ganancias_retenido_antes = 0.00
 where id = '0d3986e6-c62e-470e-9029-807c8953486f' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and retencion_ganancias_regimen is null and retencion_ganancias_monto = 520.00;

-- OP-000019 · 2026-09-18 · ANGLET SRL
update public.ordenes_pago set retencion_ganancias_regimen = '078', retencion_ganancias_minimo = 224000.00, retencion_ganancias_base_previa = 0.00, retencion_ganancias_retenido_antes = 0.00
 where id = 'd1af97e3-74e2-4ceb-b3ea-bc984e24ec23' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and retencion_ganancias_regimen is null and retencion_ganancias_monto = 4830.55;

-- OP-000020 · 2026-09-18 · STEFONI EDGARDO JOSE
update public.ordenes_pago set retencion_ganancias_regimen = '078', retencion_ganancias_minimo = 224000.00, retencion_ganancias_base_previa = 0.00, retencion_ganancias_retenido_antes = 0.00
 where id = 'a5b2c456-5461-4596-9016-7d001fd26934' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and retencion_ganancias_regimen is null and retencion_ganancias_monto = 128477.01;

-- OP-000021 · 2026-09-18 · MOLIVA NEUMATICOS S.A.
update public.ordenes_pago set retencion_ganancias_regimen = '078', retencion_ganancias_minimo = 224000.00, retencion_ganancias_base_previa = 0.00, retencion_ganancias_retenido_antes = 0.00
 where id = 'b5f78d40-13f2-4a71-b8c9-f3061b8f8caa' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and retencion_ganancias_regimen is null and retencion_ganancias_monto = 1734.88;

-- OP-000022 · 2026-09-18 · MOBILARG DE LOBO ALEJANDRO EZEQUIEL Y LOBO NATALIA SOLEDAD
update public.ordenes_pago set retencion_ganancias_regimen = '078', retencion_ganancias_minimo = 224000.00, retencion_ganancias_base_previa = 0.00, retencion_ganancias_retenido_antes = 0.00
 where id = 'bbaa4288-d77f-4017-a5ef-daa1d7145215' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and retencion_ganancias_regimen is null and retencion_ganancias_monto = 22021.36;

-- OP-000023 · 2026-09-19 · PRISINA S.A.
update public.ordenes_pago set retencion_ganancias_regimen = '078', retencion_ganancias_minimo = 224000.00, retencion_ganancias_base_previa = 0.00, retencion_ganancias_retenido_antes = 0.00
 where id = '9299399e-e54b-4b8b-8278-76968d54b28a' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and retencion_ganancias_regimen is null and retencion_ganancias_monto = 74902.52;

-- OP-000024 · 2026-09-22 · KONRAD JESUS MANUEL
update public.ordenes_pago set retencion_ganancias_regimen = '078', retencion_ganancias_minimo = 224000.00, retencion_ganancias_base_previa = 0.00, retencion_ganancias_retenido_antes = 0.00
 where id = '0c54f232-5924-417e-8e2d-7226ed435d2d' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and retencion_ganancias_regimen is null and retencion_ganancias_monto = 7520.00;

-- OP-000025 · 2026-09-23 · VETERINARIA PERGAMINO SRL
update public.ordenes_pago set retencion_ganancias_regimen = '078', retencion_ganancias_minimo = 224000.00, retencion_ganancias_base_previa = 0.00, retencion_ganancias_retenido_antes = 0.00
 where id = 'b831dd79-365a-40b6-9722-fb4f73b1fe16' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and retencion_ganancias_regimen is null and retencion_ganancias_monto = 13920.00;

-- OP-000026 · 2026-09-23 · AIR PRODUCTS S R L
update public.ordenes_pago set retencion_ganancias_regimen = '078', retencion_ganancias_minimo = 224000.00, retencion_ganancias_base_previa = 360000.00, retencion_ganancias_retenido_antes = 2720.00
 where id = 'ed8db6d5-4ff5-4bb1-a8cf-d16e190b09e0' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and retencion_ganancias_regimen is null and retencion_ganancias_monto = 2842.98;

-- OP-000027 · 2026-09-24 · SEBASTIAN ARIEL LOPEZ
update public.ordenes_pago set retencion_ganancias_regimen = '078', retencion_ganancias_minimo = 224000.00, retencion_ganancias_base_previa = 89000.00, retencion_ganancias_retenido_antes = 0.00
 where id = '2cc6a304-d034-4030-b835-437fa812d5bb' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and retencion_ganancias_regimen is null and retencion_ganancias_monto = 1652.00;

-- OP-000029 · 2026-09-24 · MEDIGLOVE S.R.L.
update public.ordenes_pago set retencion_ganancias_regimen = '078', retencion_ganancias_minimo = 224000.00, retencion_ganancias_base_previa = 0.00, retencion_ganancias_retenido_antes = 0.00
 where id = 'dab3d1de-f9b0-40c3-8736-de1a0c7e9aec' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and retencion_ganancias_regimen is null and retencion_ganancias_monto = 9884.00;

-- OP-000030 · 2026-09-24 · MATCOM S. A. S.
update public.ordenes_pago set retencion_ganancias_regimen = '078', retencion_ganancias_minimo = 224000.00, retencion_ganancias_base_previa = 320391.60, retencion_ganancias_retenido_antes = 0.00
 where id = 'dbe995fc-d231-4cc7-b932-268ff70fbc55' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and retencion_ganancias_regimen is null and retencion_ganancias_monto = 11982.00;

-- OP-000031 · 2026-09-24 · AMOBLAMIENTOS NEXO DE GARBUGLIO SEBASTIAN LEOPOLDO Y DEBERNARDI DANIEL ALBERTO
update public.ordenes_pago set retencion_ganancias_regimen = '078', retencion_ganancias_minimo = 224000.00, retencion_ganancias_base_previa = 0.00, retencion_ganancias_retenido_antes = 0.00
 where id = '38e4bf9f-f6b1-40d0-a2c2-f005817bc050' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and retencion_ganancias_regimen is null and retencion_ganancias_monto = 11410.00;

-- OP-000033 · 2026-09-24 · ANDRES ALBERTO FERNANDEZ
update public.ordenes_pago set retencion_ganancias_regimen = '078', retencion_ganancias_minimo = 224000.00, retencion_ganancias_base_previa = 0.00, retencion_ganancias_retenido_antes = 0.00
 where id = '78873067-f432-4d5d-bc92-1e722d40304d' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and retencion_ganancias_regimen is null and retencion_ganancias_monto = 478.68;

-- OP-000034 · 2026-09-24 · STAR-TEX SA
update public.ordenes_pago set retencion_ganancias_regimen = '078', retencion_ganancias_minimo = 224000.00, retencion_ganancias_base_previa = 2207518.42, retencion_ganancias_retenido_antes = 39670.37
 where id = '27e86381-6d3c-4746-8a85-5119359b7175' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and retencion_ganancias_regimen is null and retencion_ganancias_monto = 148989.22;

-- OP-000035 · 2026-09-28 · F A D I SAIC
update public.ordenes_pago set retencion_ganancias_regimen = '078', retencion_ganancias_minimo = 224000.00, retencion_ganancias_base_previa = 0.00, retencion_ganancias_retenido_antes = 0.00
 where id = '60bf6067-398b-4ff7-a00b-e26f1de36d8a' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and retencion_ganancias_regimen is null and retencion_ganancias_monto = 105520.00;

-- OP-000037 · 2026-09-29 · ARTICULOS PROMOCIONALES S.A.
update public.ordenes_pago set retencion_ganancias_regimen = '078', retencion_ganancias_minimo = 224000.00, retencion_ganancias_base_previa = 0.00, retencion_ganancias_retenido_antes = 0.00
 where id = '211a1387-4283-40c9-95cc-f943b0876545' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and retencion_ganancias_regimen is null and retencion_ganancias_monto = 15055.02;

-- OP-000047 · 2026-10-06 · SANITARIOS SAN MARTIN S.A.
update public.ordenes_pago set retencion_ganancias_regimen = '078', retencion_ganancias_minimo = 224000.00, retencion_ganancias_base_previa = 0.00, retencion_ganancias_retenido_antes = 0.00
 where id = 'ac48c744-6d28-4c1b-90af-9cc89b38384e' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and retencion_ganancias_regimen is null and retencion_ganancias_monto = 12529.61;

-- OP-000048 · 2026-10-07 · AGROLOGIA SRL
update public.ordenes_pago set retencion_ganancias_regimen = '078', retencion_ganancias_minimo = 224000.00, retencion_ganancias_base_previa = 0.00, retencion_ganancias_retenido_antes = 0.00
 where id = 'a70d0f7c-eb72-49ce-ac6f-c5f9319ece3c' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and retencion_ganancias_regimen is null and retencion_ganancias_monto = 52200.00;

-- OP-000049 · 2026-10-07 · SPEED BUSINESS S. A. (se calculó como bienes; hoy transporte)
update public.ordenes_pago set retencion_ganancias_regimen = '078', retencion_ganancias_minimo = 224000.00, retencion_ganancias_base_previa = 48560.86, retencion_ganancias_retenido_antes = 0.00
 where id = 'de5229e2-8072-4256-b0ca-d033baf20613' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and retencion_ganancias_regimen is null and retencion_ganancias_monto = 1835.90;

-- OP-000050 · 2026-10-09 · TKW S.A.
update public.ordenes_pago set retencion_ganancias_regimen = '078', retencion_ganancias_minimo = 224000.00, retencion_ganancias_base_previa = 0.00, retencion_ganancias_retenido_antes = 0.00
 where id = '769d402c-83aa-45e5-9aa0-5d7a02f05cd8' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and retencion_ganancias_regimen is null and retencion_ganancias_monto = 64288.59;

-- OP-000053 · 2026-10-13 · Sesenta Once S.R.L.
update public.ordenes_pago set retencion_ganancias_regimen = '078', retencion_ganancias_minimo = 224000.00, retencion_ganancias_base_previa = 0.00, retencion_ganancias_retenido_antes = 0.00
 where id = '4fe5a1ce-5f37-4978-b879-2ce7b38e9c0c' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and retencion_ganancias_regimen is null and retencion_ganancias_monto = 92391.50;

-- OP-000054 · 2026-10-13 · ESPUMAS PILAR SRL
update public.ordenes_pago set retencion_ganancias_regimen = '078', retencion_ganancias_minimo = 224000.00, retencion_ganancias_base_previa = 0.00, retencion_ganancias_retenido_antes = 0.00
 where id = 'bd3ef2d1-dcdb-4375-b4d0-c015388adade' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and retencion_ganancias_regimen is null and retencion_ganancias_monto = 45920.00;

-- OP-000055 · 2026-10-13 · BRUNO FRANCIONE
update public.ordenes_pago set retencion_ganancias_regimen = '078', retencion_ganancias_minimo = 224000.00, retencion_ganancias_base_previa = 0.00, retencion_ganancias_retenido_antes = 0.00
 where id = 'e4c55524-6d35-4de1-9e2c-12e8d9d72126' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and retencion_ganancias_regimen is null and retencion_ganancias_monto = 1338.18;

-- OP-000057 · 2026-10-13 · SEGUFER SA
update public.ordenes_pago set retencion_ganancias_regimen = '078', retencion_ganancias_minimo = 224000.00, retencion_ganancias_base_previa = 0.00, retencion_ganancias_retenido_antes = 0.00
 where id = '45319198-c301-4840-9e53-10bf16c4f524' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and retencion_ganancias_regimen is null and retencion_ganancias_monto = 23448.88;

-- OP-000058 · 2026-10-13 · ABRAHAM MIZRAHI
update public.ordenes_pago set retencion_ganancias_regimen = '078', retencion_ganancias_minimo = 224000.00, retencion_ganancias_base_previa = 0.00, retencion_ganancias_retenido_antes = 0.00
 where id = 'dd6a9a4b-7328-4fd5-a650-ba02b3a71caf' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and retencion_ganancias_regimen is null and retencion_ganancias_monto = 2872.07;

-- OP-000059 · 2026-10-13 · DROGUERIA EYG SRL · ANULADA
update public.ordenes_pago set retencion_ganancias_regimen = '078', retencion_ganancias_minimo = 224000.00, retencion_ganancias_base_previa = 0.00, retencion_ganancias_retenido_antes = 0.00
 where id = '0e6e56d5-b771-4864-8698-34a5125d4648' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and retencion_ganancias_regimen is null and retencion_ganancias_monto = 380296.00;

-- OP-000061 · 2026-10-13 · DROGUERIA EYG SRL
update public.ordenes_pago set retencion_ganancias_regimen = '078', retencion_ganancias_minimo = 224000.00, retencion_ganancias_base_previa = 0.00, retencion_ganancias_retenido_antes = 0.00
 where id = '942f10fd-5d58-49bd-bb59-8e078d36b27c' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and retencion_ganancias_regimen is null and retencion_ganancias_monto = 380296.00;

-- OP-000062 · 2026-10-16 · MARIANA SOCIEDAD ANONIMA
update public.ordenes_pago set retencion_ganancias_regimen = '078', retencion_ganancias_minimo = 224000.00, retencion_ganancias_base_previa = 0.00, retencion_ganancias_retenido_antes = 0.00
 where id = '2ed67b28-a78b-4f3b-9b0d-5405fb274c25' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and retencion_ganancias_regimen is null and retencion_ganancias_monto = 31559.15;

-- OP-000064 · 2026-10-16 · MOBILARG DE LOBO ALEJANDRO EZEQUIEL Y LOBO NATALIA SOLEDAD
update public.ordenes_pago set retencion_ganancias_regimen = '078', retencion_ganancias_minimo = 224000.00, retencion_ganancias_base_previa = 0.00, retencion_ganancias_retenido_antes = 0.00
 where id = 'd1e059fd-5041-4be5-a14b-434dcd7dc0f2' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and retencion_ganancias_regimen is null and retencion_ganancias_monto = 6186.56;

-- OP-000066 · 2026-10-16 · AMOBLAMIENTOS NEXO DE GARBUGLIO SEBASTIAN LEOPOLDO Y DEBERNARDI DANIEL ALBERTO
update public.ordenes_pago set retencion_ganancias_regimen = '078', retencion_ganancias_minimo = 224000.00, retencion_ganancias_base_previa = 0.00, retencion_ganancias_retenido_antes = 0.00
 where id = 'a23425de-5327-4ed9-9b51-1d28764a4ce4' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and retencion_ganancias_regimen is null and retencion_ganancias_monto = 6856.00;

-- OP-000072 · 2026-10-19 · MONTAGNE OUTDOORS S A
update public.ordenes_pago set retencion_ganancias_regimen = '078', retencion_ganancias_minimo = 224000.00, retencion_ganancias_base_previa = 0.00, retencion_ganancias_retenido_antes = 0.00
 where id = 'c49d2e1c-b22b-4a2b-aaf1-29338d7aa998' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and retencion_ganancias_regimen is null and retencion_ganancias_monto = 2642.20;

-- OP-000074 · 2026-10-20 · DEPOSITO FISCAL BUENOS AIRES SA
update public.ordenes_pago set retencion_ganancias_regimen = '078', retencion_ganancias_minimo = 224000.00, retencion_ganancias_base_previa = 0.00, retencion_ganancias_retenido_antes = 0.00
 where id = 'e4c4df23-7105-44bd-8bf1-b582d31e2e45' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and retencion_ganancias_regimen is null and retencion_ganancias_monto = 6072.15;

-- OP-000075 · 2026-10-20 · NORNES S.A.S · ANULADA
update public.ordenes_pago set retencion_ganancias_regimen = '078', retencion_ganancias_minimo = 224000.00, retencion_ganancias_base_previa = 0.00, retencion_ganancias_retenido_antes = 0.00
 where id = 'e428f30c-200b-46bb-b820-da08582b57ab' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and retencion_ganancias_regimen is null and retencion_ganancias_monto = 5499.90;

-- OP-000076 · 2026-10-20 · NORNES S.A.S
update public.ordenes_pago set retencion_ganancias_regimen = '078', retencion_ganancias_minimo = 224000.00, retencion_ganancias_base_previa = 0.00, retencion_ganancias_retenido_antes = 0.00
 where id = 'b0da17b9-7337-42bf-8afe-7f79ad0e1852' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and retencion_ganancias_regimen is null and retencion_ganancias_monto = 5499.90;

-- OP-000077 · 2026-10-20 · Pluscargo Rosario S.A
update public.ordenes_pago set retencion_ganancias_regimen = '078', retencion_ganancias_minimo = 224000.00, retencion_ganancias_base_previa = 0.00, retencion_ganancias_retenido_antes = 0.00
 where id = 'c83f68f9-1118-49bc-87f5-a8ec9cb4b4df' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and retencion_ganancias_regimen is null and retencion_ganancias_monto = 35636.38;

-- OP-000080 · 2026-10-22 · EUGENIO MASTROIANNI
update public.ordenes_pago set retencion_ganancias_regimen = '078', retencion_ganancias_minimo = 224000.00, retencion_ganancias_base_previa = 269008.36, retencion_ganancias_retenido_antes = 0.00
 where id = '3282f931-f22d-4318-a362-817666e0e5d2' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and retencion_ganancias_regimen is null and retencion_ganancias_monto = 25084.32;

-- OP-000082 · 2026-10-22 · NORNES S.A.S
update public.ordenes_pago set retencion_ganancias_regimen = '078', retencion_ganancias_minimo = 224000.00, retencion_ganancias_base_previa = 498994.88, retencion_ganancias_retenido_antes = 5499.90
 where id = '8cfdfe71-d116-457c-9488-dfd6f508a25e' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and retencion_ganancias_regimen is null and retencion_ganancias_monto = 550.64;

-- OP-000083 · 2026-10-22 · SEGUFER SA
update public.ordenes_pago set retencion_ganancias_regimen = '078', retencion_ganancias_minimo = 224000.00, retencion_ganancias_base_previa = 1396444.01, retencion_ganancias_retenido_antes = 23448.88
 where id = 'e2481847-1d03-4905-ab36-9fea7103a351' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and retencion_ganancias_regimen is null and retencion_ganancias_monto = 100267.36;

-- OP-000086 · 2026-10-23 · VECHER S.A.
update public.ordenes_pago set retencion_ganancias_regimen = '078', retencion_ganancias_minimo = 224000.00, retencion_ganancias_base_previa = 0.00, retencion_ganancias_retenido_antes = 0.00
 where id = 'a56039ec-35d7-4ff3-abca-95abe1be43d2' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and retencion_ganancias_regimen is null and retencion_ganancias_monto = 9756.80;

-- OP-000087 · 2026-10-23 · PRISINA S.A.
update public.ordenes_pago set retencion_ganancias_regimen = '078', retencion_ganancias_minimo = 224000.00, retencion_ganancias_base_previa = 0.00, retencion_ganancias_retenido_antes = 0.00
 where id = '134d4372-b047-4ec9-8bc7-b7619f8a9fd6' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and retencion_ganancias_regimen is null and retencion_ganancias_monto = 81862.40;

-- OP-000093 · 2026-10-27 · TKW S.A.
update public.ordenes_pago set retencion_ganancias_regimen = '078', retencion_ganancias_minimo = 224000.00, retencion_ganancias_base_previa = 3438429.69, retencion_ganancias_retenido_antes = 64288.59
 where id = '84f2b969-11f6-42d6-8478-09056127d1fd' and sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021' and retencion_ganancias_regimen is null and retencion_ganancias_monto = 45806.73;

do $$
declare
  n integer;
begin
  select count(*) into n from public.ordenes_pago where retencion_ganancias_regimen is not null and id in (
  'b8201072-e55a-4688-b03d-8b1ec5e91d71',
  'a56b938e-d1da-41d6-adc5-124849974d2c',
  'e8a80b29-c694-46c1-969d-3da5c3167f53',
  'f6984e29-e682-4a6f-b40e-76db00bb0e9f',
  'e55fb27c-ae24-4ac0-a2c9-520a1ab4208d',
  '62b9de21-a936-4342-a7d3-182388a89450',
  '90b8e25d-457b-49c5-b1fa-babbf7e49928',
  '0d3986e6-c62e-470e-9029-807c8953486f',
  'd1af97e3-74e2-4ceb-b3ea-bc984e24ec23',
  'a5b2c456-5461-4596-9016-7d001fd26934',
  'b5f78d40-13f2-4a71-b8c9-f3061b8f8caa',
  'bbaa4288-d77f-4017-a5ef-daa1d7145215',
  '9299399e-e54b-4b8b-8278-76968d54b28a',
  '0c54f232-5924-417e-8e2d-7226ed435d2d',
  'b831dd79-365a-40b6-9722-fb4f73b1fe16',
  'ed8db6d5-4ff5-4bb1-a8cf-d16e190b09e0',
  '2cc6a304-d034-4030-b835-437fa812d5bb',
  'dab3d1de-f9b0-40c3-8736-de1a0c7e9aec',
  'dbe995fc-d231-4cc7-b932-268ff70fbc55',
  '38e4bf9f-f6b1-40d0-a2c2-f005817bc050',
  '78873067-f432-4d5d-bc92-1e722d40304d',
  '27e86381-6d3c-4746-8a85-5119359b7175',
  '60bf6067-398b-4ff7-a00b-e26f1de36d8a',
  '211a1387-4283-40c9-95cc-f943b0876545',
  'ac48c744-6d28-4c1b-90af-9cc89b38384e',
  'a70d0f7c-eb72-49ce-ac6f-c5f9319ece3c',
  'de5229e2-8072-4256-b0ca-d033baf20613',
  '769d402c-83aa-45e5-9aa0-5d7a02f05cd8',
  '4fe5a1ce-5f37-4978-b879-2ce7b38e9c0c',
  'bd3ef2d1-dcdb-4375-b4d0-c015388adade',
  'e4c55524-6d35-4de1-9e2c-12e8d9d72126',
  '45319198-c301-4840-9e53-10bf16c4f524',
  'dd6a9a4b-7328-4fd5-a650-ba02b3a71caf',
  '0e6e56d5-b771-4864-8698-34a5125d4648',
  '942f10fd-5d58-49bd-bb59-8e078d36b27c',
  '2ed67b28-a78b-4f3b-9b0d-5405fb274c25',
  'd1e059fd-5041-4be5-a14b-434dcd7dc0f2',
  'a23425de-5327-4ed9-9b51-1d28764a4ce4',
  'c49d2e1c-b22b-4a2b-aaf1-29338d7aa998',
  'e4c4df23-7105-44bd-8bf1-b582d31e2e45',
  'e428f30c-200b-46bb-b820-da08582b57ab',
  'b0da17b9-7337-42bf-8afe-7f79ad0e1852',
  'c83f68f9-1118-49bc-87f5-a8ec9cb4b4df',
  '3282f931-f22d-4318-a362-817666e0e5d2',
  '8cfdfe71-d116-457c-9488-dfd6f508a25e',
  'e2481847-1d03-4905-ab36-9fea7103a351',
  'a56039ec-35d7-4ff3-abca-95abe1be43d2',
  '134d4372-b047-4ec9-8bc7-b7619f8a9fd6',
  '84f2b969-11f6-42d6-8478-09056127d1fd');
  if n <> 49 then
    raise exception 'Se anotaron % de 49 OP: alguna cambió desde que se armó la migración. No se guarda nada.', n;
  end if;
end $$;
