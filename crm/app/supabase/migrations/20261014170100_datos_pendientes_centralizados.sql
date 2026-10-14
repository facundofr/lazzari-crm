-- Pendientes centralizados de Augusto (pedido 14/10/2026: "centralizo todo lo que tengo atrasado o pendiente en un lugar").
-- 1) Completa área / tipo / link de los 9 pendientes que ya existían.  2) Agrega los pendientes que estaban solo en docs/ESTADO.md.
-- 3) Marca "Resuelto" en Finanzas > Revisar la fila de MARIANA SA (ya se dio de alta y se vinculó con Pegaso).
-- No borra nada. Necesita 20261014170000. Vuelta atrás: supabase/rollback/20261014170100_datos_pendientes_centralizados.sql
begin;

update public.pendientes p set area = v.area, tipo = v.tipo, link = v.link
from (values
  ('7b2e0d20-0001-4e00-9a00-000000000001'::uuid, 'Bancos y créditos', 'responder', null),
  ('7b2e0d20-0001-4e00-9a00-000000000002'::uuid, 'Gastos fijos', 'hacer', '/ordenes-compra'),
  ('7b2e0d20-0001-4e00-9a00-000000000003'::uuid, 'Gastos fijos', 'responder', '/finanzas?tab=gastos_fijos'),
  ('7b2e0d20-0001-4e00-9a00-000000000004'::uuid, 'Gastos fijos', 'responder', '/finanzas?tab=gastos_fijos'),
  ('7b2e0d20-0001-4e00-9a00-000000000005'::uuid, 'Gastos fijos', 'responder', '/finanzas?tab=gastos_fijos'),
  ('7b2e0d20-0001-4e00-9a00-000000000006'::uuid, 'Gastos fijos', 'hacer', '/finanzas?tab=gastos_manuales'),
  ('7b2e0d20-0001-4e00-9a00-000000000007'::uuid, 'Gastos fijos', 'responder', null),
  ('7b2e0d20-0001-4e00-9a00-000000000008'::uuid, 'Bancos y créditos', 'responder', '/finanzas?tab=extractos'),
  ('7b2e0d20-0001-4e00-9a00-000000000009'::uuid, 'Gastos fijos', 'responder', '/finanzas?tab=gastos_fijos')
) as v(id, area, tipo, link)
where p.id = v.id and p.area is null;

insert into public.pendientes (id, user_id, sociedad_id, texto, area, tipo, link, completado)
select ('7b2e0d20-0002-4e00-9a00-' || lpad(v.n::text, 12, '0'))::uuid,
       'cb8fdf3e-d171-4042-9da7-248fe863b96d'::uuid,
       case v.soc when 'G' then 'fee94607-747a-4e87-ba24-aff9032f7a56'::uuid else 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021'::uuid end,
       v.texto, v.area, v.tipo, v.link, false
from (values
  -- Pagos
  (1,  'L', 'Pagos', 'hacer', '/finanzas?tab=ordenes_pago', 'Hacer la OP de Segufer: US$ 1.127,65 (173,57 + 954,08) en pesos, aprox. $ 1.710.645 con TC 1.517'),
  (2,  'L', 'Pagos', 'hacer', '/finanzas?tab=ordenes_pago', 'Hacer la OP de Mariana S.A.: FC A 00012-00012760 menos NC 00010-00017374 = $ 1.048.790,01'),
  (3,  'L', 'Pagos', 'hacer', '/finanzas?tab=ordenes_pago', 'Programar el pago de Segutécnica FC 0014-00073272 $ 554.710,63 (29/09, CC 60 días): única deuda real en "Con deuda"'),
  (4,  'L', 'Pagos', 'responder', null, 'OP-000053 Sesenta Once: quedó con $ 1 de efectivo ficticio y $ 0,99 a favor. ¿Lo limpio?'),
  (5,  'L', 'Pagos', 'hacer', '/finanzas?tab=gastos_fijos', 'Alquiler US$ 800 (del 1 al 15): cada mes cargar el dólar blue que se usó'),
  (6,  'L', 'Pagos', 'responder', null, 'Avisar cuando Andrés pague los US$ 8.500 o papá pague una cuota del BNA 1, para cargar el cobro'),
  (7,  'L', 'Pagos', 'hacer', '/finanzas?tab=retenciones', 'Generar el TXT de SICORE (formato nuevo) y pasárselo al contador para confirmar que lo importa'),
  (8,  'L', 'Pagos', 'responder', '/finanzas?tab=ordenes_pago', '¿Con qué tarjeta se pagaron OP-000038 y OP-000052?'),
  -- Cobros
  (10, 'L', 'Cobros', 'responder', null, 'Del Sol: OK a la propuesta de la OP 0001-00017009 (eCheq 3968 $ 6.210.728,30 + ret. 11672 $ 99.826,69 contra FA 16-16, 16-17, 16-18 y 15-45; la "39" de $ 1.242.839,98 a cuenta de FA 15-54)'),
  (11, 'L', 'Cobros', 'responder', null, 'Del Sol: factura "39" y NCA 15-5 ($ 1.242.839,98, pagó dos veces). ¿Le pedimos que registre la NCA o la NCA era por otra cosa?'),
  (12, 'L', 'Cobros', 'responder', null, 'Del Sol: eCheq 3644 $ 11.801.686,09, diferencia $ 193.792,37 (FC-A 9-405 y 9-406). Faltan los certificados de retención'),
  (13, 'L', 'Cobros', 'responder', null, 'Del Sol: ¿la FA 16-18 ($ 1.370.733,34) es la misma venta que la FC-A 9-399 del sistema viejo (20/08)? ¿La 9-399 ya estaba cobrada?'),
  (14, 'L', 'Cobros', 'responder', '/finanzas?tab=echeqs', 'Confirmar fecha de recepción de cheques Del Sol 3644/3968 (¿09/10?), Bichara 00406334/85983561 y cobros con fecha futura (Barraza $ 10.110.492,35, Del Sol $ 3.677.887,22)'),
  (15, 'L', 'Cobros', 'hacer', '/finanzas?tab=echeqs', 'Barraza: cuando el cheque 00000131 aparezca rechazado en el extracto, rechazarlo y avisar a Claude para la NC A 0001-00000025 ($ 26.954.340,91)'),
  (16, 'L', 'Cobros', 'responder', null, '¿Cómo registramos los 21 cobros del banco de facturas del sistema anterior (no están en el CRM)?'),
  (17, 'L', 'Cobros', 'hacer', '/finanzas?tab=facturacion', 'Controlar que los 27 cobros identificados en Gmail (sept-oct, $ 232.993.760,33) estén cargados y apretar "Aplicar cruces"'),
  (18, 'L', 'Cobros', 'hacer', '/finanzas?tab=echeqs', 'Cargar cheques endosados que faltan: Pachamama 9919 (a Prisina) y Musso 2105 (a BA Valores)'),
  (19, 'L', 'Cobros', 'hacer', '/consulta-facturas', 'Avisar a Cooperativa La Nueva Leyenda y reenviarle el PDF corregido de la X 0000-00000007 ($ 251.640, vence 28/10)'),
  (20, 'L', 'Cobros', 'responder', '/clientes', 'Aerolíneas: en Lazzari figura "ARS" y en Grupo LA "USD divisa". ¿Cuál va?'),
  -- Compras y proveedores
  (30, 'L', 'Compras y proveedores', 'hacer', '/proveedores', 'Pasar la condición de pago del resto de los proveedores (ya están Prisina, TKW, Segutécnica, Star-Tex, DPS)'),
  (31, 'L', 'Compras y proveedores', 'hacer', '/proveedores', 'Pedir listas nuevas a los que están en rojo: Conoflex, Fravida, Delta Plus, FADI, Segutécnica, Mediglove, Prisina'),
  (32, 'L', 'Compras y proveedores', 'hacer', null, 'Corregir la lista de Pegaso en el chat de listas: todavía descuenta el 5 % opcional (debe ser lista −20 % fijo)'),
  (33, 'L', 'Compras y proveedores', 'hacer', '/ordenes-compra', 'Decidir las 4 OC con diferencia: OC-1062, 1088, 1180 (precio) y OC-1199 (faltan 2 u., $ 72.600,09): "Ajustar a la factura" o "Cerrar"'),
  (34, 'L', 'Compras y proveedores', 'hacer', '/ordenes-compra', 'OC-1043 (cancelada, con recepción y factura): que la revisen los vendedores'),
  (35, 'L', 'Compras y proveedores', 'hacer', '/ordenes-compra', 'Cargar la FC A 0003-00005284 de Amoblamientos Nexo ($ 685.828, con envío $ 90.000) contra OC-2026-1229'),
  (36, 'L', 'Compras y proveedores', 'hacer', '/ordenes-compra', 'Mercado Libre: a fin de mes subir todas las facturas y atarlas a su OC (anotar el N° de compra ML en la OC)'),
  -- Gastos fijos
  (40, 'L', 'Gastos fijos', 'responder', '/finanzas?tab=gastos_fijos', 'Día de vencimiento de cada gasto fijo'),
  (41, 'L', 'Gastos fijos', 'responder', '/finanzas?tab=gastos_fijos', 'Contador Musso: ¿lo paga solo Lazzari o también Grupo LA?'),
  (42, 'L', 'Gastos fijos', 'responder', '/finanzas?tab=gastos_fijos', 'Pasar "más fijos" además de sueldos y alquiler (para "¿Cubro los fijos?")'),
  -- Bancos y créditos
  (50, 'L', 'Bancos y créditos', 'hacer', '/finanzas?tab=extractos', 'Resolver de a poco las líneas "Para revisar" del extracto BBVA'),
  (51, 'L', 'Bancos y créditos', 'responder', null, 'Explicar la extracción de $ 6.200.000 de la CA del 25/09 que no está en la planilla de caja'),
  (52, 'L', 'Bancos y créditos', 'responder', '/finanzas?tab=lineas_credito', 'Crédito BNA 2 (lo paga Andrés Leguizamo): pasar la tabla de cuotas y el detalle'),
  (53, 'L', 'Bancos y créditos', 'responder', null, 'Colchón mínimo para el apartado mensual de devolución a Cecilia (US$ 25.000) y José (US$ 18.500)'),
  (54, 'L', 'Bancos y créditos', 'responder', '/finanzas?tab=cuentas', 'BAVSA: pasar el saldo en pesos (había US$ 10.000) para cargarla como cuenta'),
  (55, 'L', 'Bancos y créditos', 'responder', null, 'Pasar los resúmenes de Visa ·1582 y Master ·4775 para cargar la deuda de tarjetas (hoy figura 0)'),
  (56, 'L', 'Bancos y créditos', 'hacer', null, 'Preguntar al ejecutivo BBVA por API / host-to-host / envío automático de extractos y el formato Net Cash'),
  (57, 'L', 'Bancos y créditos', 'responder', '/finanzas?tab=echeqs', 'Cheques 2026: decidir 3 diferencias (emitido 496366 pendiente/cobrado, fechas de 00000176 y 00000074, emitido 90017380 duplicado)'),
  -- Sistema
  (60, 'L', 'Sistema', 'hacer', null, 'Que Mariana (administrativa) y un vendedor prueben los permisos nuevos; si algo falla hay vuelta atrás'),
  (61, 'L', 'Sistema', 'hacer', '/ventas', 'Emitir la primera factura ARCA desde Ventas y desde Facturación y revisar PDF y total'),
  (62, 'L', 'Sistema', 'hacer', '/configuracion', 'Revisar fechas de cheque: 12/10 feriado, 31/10 sábado, 21/11 sábado (se debita 24/11), 20/12 domingo'),
  (63, 'L', 'Sistema', 'hacer', null, 'Seguridad: rotar la clave de Anthropic y activar la verificación en dos pasos (MFA) en Supabase y Vercel'),
  (64, 'L', 'Sistema', 'responder', null, 'Manu sigue como "admin" (puede operar finanzas). ¿Lo dejamos así?'),
  -- Decisiones
  (70, 'L', 'Decisiones', 'responder', null, 'Al editar un PR se rehacen sus OC aunque tengan recepción o factura. ¿Arreglamos que no las toque?'),
  (71, 'L', 'Decisiones', 'responder', null, 'OK a la propuesta de Papelera (docs/PROPUESTA-PAPELERA-14-10-2026.md)'),
  (72, 'L', 'Decisiones', 'responder', null, 'Alerta de CUIT apócrifo: confirmar fuentes de ARCA (APOC, padrón, constatación)'),
  (73, 'L', 'Decisiones', 'responder', null, 'Pasar un ejemplo para unificar "Cheque físico / electrónico"'),
  (74, 'L', 'Decisiones', 'responder', null, 'Responder las preguntas de Comisiones (idea 1) y Torneo (idea 7)'),
  (75, 'L', 'Decisiones', 'responder', null, 'Objetivo $ 120M netos: período, qué sociedad suma, conversión USD, quién la ve y a quién felicita'),
  (76, 'L', 'Decisiones', 'responder', null, 'Ranking de compradores y empresas: período y cómo agrupar'),
  (77, 'L', 'Decisiones', 'hacer', null, 'Sentarse con Claude: personalización en el PR, oportunidades, preguntas por cliente, armado de presupuestos y facturar masivo'),
  (78, 'L', 'Decisiones', 'responder', null, 'OK a la propuesta de Seguimiento y Dashboard (Tanda E) cuando Claude la presente')
) as v(n, soc, area, tipo, link, texto)
on conflict (id) do nothing;

update public.finanzas_revisar
set estado = 'resuelto', resolucion = 'Alta hecha y vinculado con Pegaso (FC y NC cargadas). Cerrado desde Pendientes 14/10/2026.', resuelto_at = now()
where id = 'e0cf1daf-c3e8-49cc-af2a-d5a51c3ab061' and estado = 'pendiente';

commit;
