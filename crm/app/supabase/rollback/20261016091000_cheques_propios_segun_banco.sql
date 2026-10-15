-- Vuelta atrás de 20261016091000: vuelve a "entregado" los cheques que ese archivo cambió (marcados en observaciones).
begin;
update public.echeqs
set estado = 'entregado',
    observaciones = nullif(trim(both ' ' from regexp_replace(coalesce(observaciones, ''), ' ?\[16/10/2026: (PAGADO según reporte eCheqs BBVA 15/10|copia repetida del cheque 90017380)[^]]*\]', '')), '')
where sociedad_id = 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021'
  and observaciones like '%[16/10/2026: %antes entregado]%';
commit;
