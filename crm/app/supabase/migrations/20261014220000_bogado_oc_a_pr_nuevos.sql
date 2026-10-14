-- Comuna de Coronel Bogado (14/10/2026, OK de Augusto): FB 0015-00000008 y 0015-00000009 se anularon con NCB 3 y NCB 4.
-- Las OC de esas ventas pasan a los PR nuevos, así la factura nueva sale con su costo real:
--   OC-2026-1221 (Mariana SA)            -> PR-2026-1253
--   OC-2026-1239 y OC-2026-1240 (Macro Blanco) -> PR-2026-1254
-- Solo cambia presupuesto_origen_id de 3 OC. Las facturas de compra, pagos y recepciones siguen colgadas de sus OC.
begin;
do $$
declare p1253 uuid; p1254 uuid; n int;
begin
  select id into p1253 from public.presupuestos where numero = 'PR-2026-1253' and eliminado = false;
  select id into p1254 from public.presupuestos where numero = 'PR-2026-1254' and eliminado = false;
  if p1253 is null or p1254 is null then raise exception 'No se encontraron los PR nuevos'; end if;

  update public.ordenes_compra set presupuesto_origen_id = p1253
   where numero = 'OC-2026-1221' and presupuesto_origen_id = (select id from public.presupuestos where numero = 'PR-2026-1215');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'OC-2026-1221: se esperaba 1 fila y fueron %', n; end if;

  update public.ordenes_compra set presupuesto_origen_id = p1254
   where (numero = 'OC-2026-1239' and presupuesto_origen_id = (select id from public.presupuestos where numero = 'PR-2026-1215'))
      or (numero = 'OC-2026-1240' and presupuesto_origen_id = (select id from public.presupuestos where numero = 'PR-2026-1252'));
  get diagnostics n = row_count;
  if n <> 2 then raise exception 'OC-1239/1240: se esperaban 2 filas y fueron %', n; end if;
end $$;
commit;
