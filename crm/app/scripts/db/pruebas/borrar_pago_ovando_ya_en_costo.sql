select 'gasto' t, count(*)::text r from gastos_manuales where id='8a9fd4d3-f421-4324-a035-b70d9044af96'
union all select 'pago anulado', (anulado::text || ' monto ' || monto) from movimientos where id='c338e6df-80d7-4c04-9f4c-6fe0c4c97a92'
union all select 'linea banco', (estado::text || ' / match ' || coalesce(match_movimiento_id::text,'-')) from extracto_movimientos where id='0ffb1b73-7941-4654-a489-0871bd69b5ea'
