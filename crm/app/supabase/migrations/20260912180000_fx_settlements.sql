-- USD is the document unit; ARS is the cash unit. Never rewrite invoice FX/CAE.
-- Apply in one transaction. Existing ambiguous payments are NOT converted.
begin;
create table if not exists public.liquidaciones_fx (
 id uuid primary key default gen_random_uuid(),
 sociedad_id uuid not null references public.sociedades(id),
 request_key uuid not null,
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 kind text not null check(kind in ('cobro','pago')),
 counterparty_id uuid not null,
 fecha date not null,
 cotizacion numeric(20,6) not null check(cotizacion > 0),
 cotizacion_fecha date not null,
 modalidad text not null check(modalidad in ('divisas','billetes','manual')),
 payload jsonb not null,
 orden_pago_id uuid references public.ordenes_pago(id),
 anulado boolean not null default false,
 anulado_at timestamptz,
 anulado_por uuid references public.profiles(id),
 unique(sociedad_id,request_key)
);
create table if not exists public.aplicaciones_fx (
 id uuid primary key default gen_random_uuid(),
 liquidacion_id uuid not null references public.liquidaciones_fx(id),
 documento_id uuid not null,
 monto_usd numeric(20,2) not null check(monto_usd>0),
 monto_ars numeric(20,2) not null check(monto_ars>0),
 cotizacion_original numeric(20,6),
 diferencia_cambio_ars numeric(20,2),
 estado_previo text not null,
 unique(liquidacion_id,documento_id)
);
alter table public.movimientos add column if not exists liquidacion_fx_id uuid references public.liquidaciones_fx(id);
create index if not exists movimientos_liquidacion_fx_idx on public.movimientos(liquidacion_fx_id);
alter table public.liquidaciones_fx enable row level security;
alter table public.aplicaciones_fx enable row level security;
revoke all on public.liquidaciones_fx, public.aplicaciones_fx from anon, authenticated;
grant select on public.liquidaciones_fx, public.aplicaciones_fx to authenticated;
drop policy if exists fx_read on public.liquidaciones_fx;
create policy fx_read on public.liquidaciones_fx for select to authenticated using (
 exists(select 1 from public.user_sociedades us where us.user_id=auth.uid() and us.sociedad_id=liquidaciones_fx.sociedad_id)
);
drop policy if exists fx_app_read on public.aplicaciones_fx;
create policy fx_app_read on public.aplicaciones_fx for select to authenticated using (
 exists(select 1 from public.liquidaciones_fx l where l.id=aplicaciones_fx.liquidacion_id)
);

-- Internal balance function, always called after locking the document.
create or replace function public.fx_documento_pagado(p_kind text,p_id uuid,p_soc uuid)
returns numeric language plpgsql security definer set search_path=public as $$
declare v_paid numeric; v_other numeric; v_currency text;
begin
 if p_kind='cobro' then
  select moneda::text into v_currency from facturas where id=p_id and sociedad_id=p_soc;
  -- Refuse legacy ambiguous ARS amounts instead of silently subtracting pesos from USD.
  if exists(select 1 from movimientos where factura_id=p_id and sociedad_id=p_soc and not coalesce(anulado,false) and moneda::text<>v_currency and monto<>0)
    or exists(select 1 from cobro_aplicaciones a join movimientos m on m.id=a.movimiento_id where a.factura_id=p_id and m.sociedad_id=p_soc and not coalesce(m.anulado,false) and m.moneda::text<>v_currency and m.liquidacion_fx_id is null) then
   raise exception 'La factura tiene cobros históricos en otra moneda sin conciliación; revisar antes de continuar';
  end if;
  select coalesce(sum(monto),0) into v_paid from movimientos where factura_id=p_id and sociedad_id=p_soc and not coalesce(anulado,false);
  select coalesce(sum(a.monto),0) into v_other from cobro_aplicaciones a join movimientos m on m.id=a.movimiento_id
   where a.factura_id=p_id and m.sociedad_id=p_soc and not coalesce(m.anulado,false);
 else
  select moneda::text into v_currency from facturas_compra where id=p_id and sociedad_id=p_soc;
  if exists(select 1 from movimientos where factura_compra_id=p_id and sociedad_id=p_soc and tipo::text='pago' and not coalesce(anulado,false) and moneda::text<>v_currency and monto<>0) then
   raise exception 'La factura tiene pagos históricos en otra moneda sin conciliación; revisar antes de continuar';
  end if;
  select coalesce(sum(monto+coalesce(retencion_ganancias_monto,0)),0) into v_paid from movimientos
   where factura_compra_id=p_id and sociedad_id=p_soc and tipo::text='pago' and not coalesce(anulado,false);
  select coalesce(sum(a.monto),0) into v_other from op_facturas_compra a join ordenes_pago op on op.id=a.orden_pago_id
   where a.factura_compra_id=p_id and op.sociedad_id=p_soc and op.estado<>'anulada';
 end if;
 return v_paid+v_other;
end $$;
revoke all on function public.fx_documento_pagado(text,uuid,uuid) from public,anon,authenticated;

create or replace function public.liquidar_documentos_fx(
 p_sociedad_id uuid,p_request_key uuid,p_kind text,p_counterparty_id uuid,p_fecha date,
 p_cotizacion numeric,p_cotizacion_fecha date,p_modalidad text,p_documentos jsonb,p_medios jsonb,p_retenciones jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_id uuid; v_existing liquidaciones_fx%rowtype; v_payload jsonb;
 d jsonb; line jsonb; f jsonb; v_doc uuid; v_usd numeric; v_ars numeric;
 v_bruto numeric:=0; v_neto numeric:=0; v_ret numeric:=0; v_gan numeric:=0; v_base numeric:=0;
 v_saldo numeric; v_tc_original numeric; v_mov uuid; v_anchor uuid; v_op uuid; v_num text;
 v_today date:=(now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
 if auth.uid() is null or not exists(select 1 from profiles where id=auth.uid() and role in ('super_admin','admin','administrativo'))
  or not exists(select 1 from user_sociedades where user_id=auth.uid() and sociedad_id=p_sociedad_id) then
  raise exception 'No tenés permiso para operar esta sociedad';
 end if;
 if p_request_key is null or p_counterparty_id is null or p_kind is null or p_kind not in ('cobro','pago')
  or p_cotizacion is null or p_cotizacion<=0 or p_cotizacion>100000000 or p_cotizacion<>round(p_cotizacion,6)
  or p_fecha is null or p_fecha>v_today or p_cotizacion_fecha is null or p_cotizacion_fecha>p_fecha
  or p_modalidad is null or p_modalidad not in ('divisas','billetes','manual') then raise exception 'Datos de liquidación o cotización inválidos'; end if;
 if jsonb_typeof(p_documentos) is distinct from 'array' or jsonb_array_length(p_documentos)=0 or jsonb_array_length(p_documentos)>100
  or jsonb_typeof(p_medios) is distinct from 'array' or jsonb_array_length(p_medios)=0
  or jsonb_typeof(p_retenciones) is distinct from 'array' then raise exception 'Documentos y medios requeridos'; end if;
 if (select count(*)<>count(distinct x->>'id') from jsonb_array_elements(p_documentos) x) then raise exception 'Documento duplicado'; end if;
 v_payload:=jsonb_build_object('kind',p_kind,'counterparty',p_counterparty_id,'fecha',p_fecha,'tc',p_cotizacion,'tc_fecha',p_cotizacion_fecha,'modalidad',p_modalidad,'documentos',p_documentos,'medios',p_medios,'retenciones',p_retenciones);
 -- Serializes retries and monthly payment bases for this party within this company.
 perform pg_advisory_xact_lock(hashtextextended(p_sociedad_id::text||p_counterparty_id::text,0));
 select * into v_existing from liquidaciones_fx where sociedad_id=p_sociedad_id and request_key=p_request_key;
 if found then
  if v_existing.payload<>v_payload or v_existing.created_by<>auth.uid() then raise exception 'La solicitud ya existe con otros datos'; end if;
  return jsonb_build_object('id',v_existing.id,'orden_pago_id',v_existing.orden_pago_id,'anulado',v_existing.anulado,'replayed',true);
 end if;
 -- Validate all lines before changing any balance.
 for line in select value from jsonb_array_elements(p_medios) loop
  if coalesce(line->>'tipo','') not in ('transferencia','efectivo','deposito','cheque_recibido') or coalesce((line->>'monto')::numeric,0)<=0
   or (line->>'monto')::numeric<>round((line->>'monto')::numeric,2) or coalesce((line->>'fecha')::date,p_fecha)<>p_fecha then
   raise exception 'Medio inválido: use importes ARS positivos y la fecha de esta liquidación'; end if;
  v_neto:=v_neto+(line->>'monto')::numeric;
 end loop;
 for line in select value from jsonb_array_elements(p_retenciones) loop
  if coalesce(line->>'tipo','') not in ('retencion_iva','retencion_ganancias','retencion_iibb','retencion_suss')
   or coalesce((line->>'monto')::numeric,0)<=0 or (line->>'monto')::numeric<>round((line->>'monto')::numeric,2)
   or coalesce(trim(line->>'certificado'),'')='' then raise exception 'Retención inválida: importe ARS y certificado requeridos'; end if;
  v_ret:=v_ret+(line->>'monto')::numeric;
  if line->>'tipo'='retencion_ganancias' then v_gan:=v_gan+(line->>'monto')::numeric; end if;
 end loop;
 insert into liquidaciones_fx(sociedad_id,request_key,created_by,kind,counterparty_id,fecha,cotizacion,cotizacion_fecha,modalidad,payload)
 values(p_sociedad_id,p_request_key,auth.uid(),p_kind,p_counterparty_id,p_fecha,p_cotizacion,p_cotizacion_fecha,p_modalidad,v_payload) returning id into v_id;
 for d in select value from jsonb_array_elements(p_documentos) order by value->>'id' loop
  v_doc:=(d->>'id')::uuid; v_usd:=(d->>'monto_usd')::numeric;
  if v_usd is null or v_usd<=0 or v_usd<>round(v_usd,2) then raise exception 'Importe USD inválido'; end if;
  f:=null;
  if p_kind='cobro' then
   select to_jsonb(t) into f from facturas t where id=v_doc and sociedad_id=p_sociedad_id and cliente_id=p_counterparty_id for update;
  else
   select to_jsonb(t) into f from facturas_compra t where id=v_doc and sociedad_id=p_sociedad_id and proveedor_id=p_counterparty_id for update;
  end if;
  if f is null or f->>'moneda'<>'USD' or f->>'estado' in ('anulada','borrador','pendiente_aprobacion') then raise exception 'Factura inexistente, no aprobada, anulada o de otra moneda/sociedad'; end if;
  if p_kind='cobro' and (coalesce(f->>'tipo','') like 'NC%' or f->>'tipo' in ('203','208','213')) then raise exception 'No se puede cobrar una nota de crédito'; end if;
  if p_fecha<(f->>'fecha')::date then raise exception 'La liquidación no puede ser anterior a la factura'; end if;
  v_saldo:=(f->>'total')::numeric-coalesce((f->>'total_acreditado')::numeric,0)-fx_documento_pagado(p_kind,v_doc,p_sociedad_id);
  if v_usd>round(v_saldo,2) then raise exception 'El importe supera el saldo actual de la factura. Actualizá la liquidación'; end if;
  v_ars:=round(v_usd*p_cotizacion,2);
  if v_ars<=0 then raise exception 'Importe convertido menor a un centavo'; end if;
  v_bruto:=v_bruto+v_ars;
  v_base:=v_base+round(v_ars*coalesce((f->>'subtotal')::numeric,0)/nullif((f->>'total')::numeric,0),2);
  v_tc_original:=coalesce(nullif(f->>'cotizacion','')::numeric,nullif(f->>'tipo_cambio','')::numeric);
  if v_tc_original<=0 then v_tc_original:=null; end if;
  insert into aplicaciones_fx(liquidacion_id,documento_id,monto_usd,monto_ars,cotizacion_original,diferencia_cambio_ars,estado_previo)
  values(v_id,v_doc,v_usd,v_ars,v_tc_original,case when v_tc_original is null then null else round(v_usd*(p_cotizacion-v_tc_original),2) end,f->>'estado');
 end loop;
 if v_bruto<>v_neto+v_ret then raise exception 'Los pesos y retenciones no coinciden con los dólares a cancelar por la cotización'; end if;
 perform set_config('app.fx_anular',v_id::text,true);
 if p_kind='pago' then
  v_num:='OP-FX-'||v_id::text;
  insert into ordenes_pago(numero,fecha,proveedor_id,monto_bruto,base_retencion_ganancias,retencion_ganancias_monto,neto_a_pagar,moneda,medio_pago,medios_pago,estado,sociedad_id,created_by,notas)
  values(v_num,p_fecha,p_counterparty_id,v_bruto,v_base,v_gan,v_neto,'ARS',p_medios->0->>'tipo',p_medios::text,'pagada',p_sociedad_id,auth.uid(),'Liquidación USD/ARS. Retenciones ingresadas según certificados. TC '||p_cotizacion||' del '||p_cotizacion_fecha)
  returning id into v_op;
  update liquidaciones_fx set orden_pago_id=v_op where id=v_id;
  insert into op_facturas_compra(orden_pago_id,factura_compra_id,monto)
   select v_op,documento_id,monto_usd from aplicaciones_fx where liquidacion_id=v_id;
 end if;
 for line in select value from jsonb_array_elements(p_medios||p_retenciones) loop
  insert into movimientos(tipo,cliente_id,proveedor_id,monto,moneda,fecha,descripcion,conciliado,sociedad_id,created_by,liquidacion_fx_id)
  values((case when left(line->>'tipo',10)='retencion_' then line->>'tipo' when p_kind='pago' then 'pago' else 'cobro' end)::public.movimiento_tipo,
   case when p_kind='cobro' then p_counterparty_id end,case when p_kind='pago' then p_counterparty_id end,
   (line->>'monto')::numeric,'ARS',p_fecha,coalesce(v_num,'Cobro FX')||' — '||(line->>'tipo')||' '||coalesce(line->>'referencia',line->>'certificado','')||' | TC '||p_cotizacion||' del '||p_cotizacion_fecha,
   false,p_sociedad_id,auth.uid(),v_id) returning id into v_mov;
  if v_anchor is null then v_anchor:=v_mov; end if;
 end loop;
 -- One anchor per settlement: applications already include retentions, never sum them twice.
 if p_kind='cobro' then
  insert into cobro_aplicaciones(movimiento_id,factura_id,monto)
   select v_anchor,documento_id,monto_usd from aplicaciones_fx where liquidacion_id=v_id;
 end if;
 for d in select to_jsonb(a) from aplicaciones_fx a where liquidacion_id=v_id loop
  v_doc:=(d->>'documento_id')::uuid;
  if p_kind='cobro' then
   update facturas set estado=case when total-coalesce(total_acreditado,0)-fx_documento_pagado('cobro',id,p_sociedad_id)<=0.005 then 'pagada'::public.factura_status else 'parcial'::public.factura_status end where id=v_doc and sociedad_id=p_sociedad_id;
  else
   update facturas_compra set estado='pagada' where id=v_doc and sociedad_id=p_sociedad_id and total-fx_documento_pagado('pago',id,p_sociedad_id)<=0.005;
  end if;
 end loop;
 perform set_config('app.fx_anular','',true);
 return jsonb_build_object('id',v_id,'orden_pago_id',v_op,'bruto_ars',v_bruto,'neto_ars',v_neto,'retenciones_ars',v_ret);
end $$;
revoke all on function public.liquidar_documentos_fx(uuid,uuid,text,uuid,date,numeric,date,text,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.liquidar_documentos_fx(uuid,uuid,text,uuid,date,numeric,date,text,jsonb,jsonb,jsonb) to authenticated;

-- Monetary edits/deletion through legacy screens would break the USD applications.
create or replace function public.proteger_movimiento_fx() returns trigger language plpgsql as $$
begin
 if tg_op='INSERT' then
  if new.liquidacion_fx_id is not null and current_user in ('authenticated','anon') then raise exception 'Use liquidar_documentos_fx'; end if;
  return new;
 end if;
 if tg_op='UPDATE' and new.liquidacion_fx_id is distinct from old.liquidacion_fx_id then raise exception 'No se puede cambiar la liquidación de un movimiento'; end if;
 if old.liquidacion_fx_id is not null and coalesce(current_setting('app.fx_anular',true),'')<>old.liquidacion_fx_id::text then
  if tg_op='DELETE' then raise exception 'Anulá la liquidación completa; no se pueden borrar sus movimientos'; end if;
  if (to_jsonb(new)-'conciliado'-'extracto_movimiento_id') is distinct from (to_jsonb(old)-'conciliado'-'extracto_movimiento_id') then raise exception 'Anulá y registrá nuevamente la liquidación para corregirla'; end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
drop trigger if exists proteger_movimiento_fx on public.movimientos;
create trigger proteger_movimiento_fx before insert or update or delete on public.movimientos for each row execute function public.proteger_movimiento_fx();

create or replace function public.anular_liquidacion_fx(p_id uuid,p_sociedad_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare l liquidaciones_fx%rowtype; a aplicaciones_fx%rowtype; v_paid numeric;
begin
 if auth.uid() is null or not exists(select 1 from profiles where id=auth.uid() and role in ('super_admin','admin','administrativo'))
  or not exists(select 1 from user_sociedades where user_id=auth.uid() and sociedad_id=p_sociedad_id) then raise exception 'Sin permiso para esta sociedad'; end if;
 select * into l from liquidaciones_fx where id=p_id and sociedad_id=p_sociedad_id;
 if not found then raise exception 'Liquidación inexistente'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_sociedad_id::text||l.counterparty_id::text,0));
 select * into l from liquidaciones_fx where id=p_id for update;
 if l.anulado then return jsonb_build_object('ok',true,'anulado',true); end if;
 for a in select * from aplicaciones_fx where liquidacion_id=p_id order by documento_id loop
  if l.kind='cobro' then perform 1 from facturas where id=a.documento_id for update;
  else perform 1 from facturas_compra where id=a.documento_id for update; end if;
 end loop;
 perform set_config('app.fx_anular',p_id::text,true);
 -- Bank reconciliations must be undone first, never silently detach a statement.
 if exists(select 1 from movimientos where liquidacion_fx_id=p_id and extracto_movimiento_id is not null) then raise exception 'Desconciliá primero los movimientos bancarios de esta liquidación'; end if;
 delete from cobro_aplicaciones where movimiento_id in (select id from movimientos where liquidacion_fx_id=p_id);
 update movimientos set anulado=true,monto_original=monto,monto=0,anulado_at=now(),anulado_por=auth.uid(),conciliado=false where liquidacion_fx_id=p_id;
 update ordenes_pago set estado='anulada' where id=l.orden_pago_id and sociedad_id=p_sociedad_id;
 update liquidaciones_fx set anulado=true,anulado_at=now(),anulado_por=auth.uid() where id=p_id;
 for a in select * from aplicaciones_fx where liquidacion_id=p_id loop
  v_paid:=fx_documento_pagado(l.kind,a.documento_id,p_sociedad_id);
  if l.kind='cobro' then
   update facturas set estado=case when v_paid+coalesce(total_acreditado,0)>=total-0.005 then 'pagada'::public.factura_status when v_paid+coalesce(total_acreditado,0)>0 then 'parcial'::public.factura_status else 'emitida'::public.factura_status end where id=a.documento_id and sociedad_id=p_sociedad_id and estado<>'anulada';
  else
   update facturas_compra set estado='pendiente' where id=a.documento_id and sociedad_id=p_sociedad_id and estado='pagada' and v_paid<total-0.005;
  end if;
 end loop;
 perform set_config('app.fx_anular','',true);
 return jsonb_build_object('ok',true,'anulado',true);
end $$;
revoke all on function public.anular_liquidacion_fx(uuid,uuid) from public,anon;
grant execute on function public.anular_liquidacion_fx(uuid,uuid) to authenticated;

create or replace function public.proteger_vinculo_fx() returns trigger language plpgsql security definer set search_path=public as $$
declare v_id uuid; r jsonb;
begin
 if tg_op='INSERT' then r:=to_jsonb(new); else r:=to_jsonb(old); end if;
 if tg_table_name='ordenes_pago' then select id into v_id from liquidaciones_fx where orden_pago_id=(r->>'id')::uuid;
 elsif tg_table_name='op_facturas_compra' then select id into v_id from liquidaciones_fx where orden_pago_id=(r->>'orden_pago_id')::uuid;
 else select liquidacion_fx_id into v_id from movimientos where id=(r->>'movimiento_id')::uuid; end if;
 if v_id is not null and coalesce(current_setting('app.fx_anular',true),'')<>v_id::text then
  if tg_table_name='ordenes_pago' and tg_op='UPDATE' then
   -- Nonfinancial delivery/attachment fields may be updated normally.
   if new.estado is not distinct from old.estado and new.moneda is not distinct from old.moneda and new.monto_bruto is not distinct from old.monto_bruto
    and new.neto_a_pagar is not distinct from old.neto_a_pagar and new.proveedor_id is not distinct from old.proveedor_id
    and new.sociedad_id is not distinct from old.sociedad_id and new.fecha is not distinct from old.fecha
    and new.medios_pago is not distinct from old.medios_pago and new.retencion_ganancias_monto is not distinct from old.retencion_ganancias_monto
    and new.base_retencion_ganancias is not distinct from old.base_retencion_ganancias then return new; end if;
  end if;
  raise exception 'Esta operación pertenece a una liquidación FX: anulala completa para corregirla';
 end if;
 if tg_op='UPDATE' and tg_table_name<>'ordenes_pago' then
  if tg_table_name='op_facturas_compra' then select id into v_id from liquidaciones_fx where orden_pago_id=(to_jsonb(new)->>'orden_pago_id')::uuid;
  else select liquidacion_fx_id into v_id from movimientos where id=(to_jsonb(new)->>'movimiento_id')::uuid; end if;
  if v_id is not null then raise exception 'No se puede reasignar una aplicación a una liquidación FX'; end if;
 end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
drop trigger if exists proteger_op_fx on public.ordenes_pago;
create trigger proteger_op_fx before update or delete on public.ordenes_pago for each row execute function public.proteger_vinculo_fx();
drop trigger if exists proteger_op_link_fx on public.op_facturas_compra;
create trigger proteger_op_link_fx before insert or update or delete on public.op_facturas_compra for each row execute function public.proteger_vinculo_fx();
drop trigger if exists proteger_cobro_link_fx on public.cobro_aplicaciones;
create trigger proteger_cobro_link_fx before insert or update or delete on public.cobro_aplicaciones for each row execute function public.proteger_vinculo_fx();
commit;
