-- Sanitarios San Martin devolvio la plata cobrada de mas (transferencia 22/10/2026, $216.913,48): se cierra el saldo a favor de $215.919,17.
update saldos_favor_proveedor set saldo = 0, estado = 'aplicado', updated_at = now()
where id = '5a1f0c52-8b6e-4c3a-9d7e-22102026aa01' and estado = 'disponible' and saldo = 215919.17;
