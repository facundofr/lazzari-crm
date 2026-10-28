-- Vuelta atrás de 20261028161000_aviso_total_factura_pagada.sql. Los avisos ya creados en finanzas_revisar quedan (no se borran).
begin;
drop trigger if exists lz_aviso_total_factura_pagada on public.facturas_compra;
drop function if exists public.lz_aviso_total_factura_pagada();
commit;
